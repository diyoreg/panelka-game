"""Cuts the ambience recording into separate pieces.

Steps (macOS, no ffmpeg needed):
    afconvert -f WAVE -d LEI16 data/sources/ambience_panelka.m4a /tmp/src.wav
    python3 data/tools/split_music.py /tmp/src.wav /tmp/parts panelka
    for f in /tmp/parts/*.wav; do afconvert -f m4af -d aac -b 128000 "$f" "public/audio/$(basename ${f%.wav}).m4a"; done
    cp /tmp/parts/tracks.json public/audio/

The city preset is left from Walk and Relax, where this game was one of two maps.
City: cut points are the loudness dips between tracks (below -30 dB).
Panelka: there are no quiet gaps. The music under the ambience repeats every 760 s (12:40),
three tracks of about 4:13 per cycle; the cuts are at the track changes (spectral novelty peaks
that come back every 760 s, with a small loudness dip). The first 1:28 is the tail of a track
and stays with part01.
Each piece is trimmed of silence, gets a 2.5 s fade-in and a 5 s fade-out.
The in-game player also crossfades between pieces.
"""
import sys
import os
import json
import numpy as np
import soundfile as sf

APPROX = {
    'city': [4*60+1, 8*60+11, 12*60+51, 17*60+1, 20*60+38, 24*60+52, 29*60+31, 34*60+18,
             39*60+7, 43*60+52, 48*60+31, 53*60+19, 58*60+5, 62*60+20, 66*60+33],
    'panelka': [t + 760 * k for k in range(5) for t in (88, 343, 599)][1:-1],
}


def main(src, out, preset='city'):
    os.makedirs(out, exist_ok=True)
    d, sr = sf.read(src, dtype='float32', always_2d=True)
    m = d.mean(1)
    hop = sr // 20

    def env(a, b):
        seg = m[a:b]
        n = len(seg) // hop
        return 20 * np.log10(np.sqrt((seg[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)

    cuts = [0]
    for t in APPROX[preset]:
        a = int((t - 6) * sr)
        cuts.append(a + int(np.argmin(env(a, int((t + 6) * sr)))) * hop + hop // 2)
    cuts.append(len(m))
    segs = []
    for k in range(len(cuts) - 1):
        a, b = cuts[k], cuts[k + 1]
        e = env(a, b)
        nz = np.where(e > -45)[0]
        a2 = a + max(0, nz[0] - 2) * hop
        b2 = a + min(len(e), nz[-1] + 3) * hop
        x = d[a2:b2].copy()
        fi, fo = int(2.5 * sr), int(5 * sr)
        x[:fi] *= (np.sin(np.linspace(0, np.pi / 2, fi)) ** 2)[:, None]
        x[-fo:] *= (np.cos(np.linspace(0, np.pi / 2, fo)) ** 2)[:, None]
        name = f'part{k + 1:02d}'
        sf.write(os.path.join(out, name + '.wav'), x, sr, subtype='PCM_16')
        segs.append({'file': name + '.m4a', 'dur': round(len(x) / sr, 2)})
    json.dump(segs, open(os.path.join(out, 'tracks.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:4])
