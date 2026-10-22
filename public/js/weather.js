// Snowfall: how hard it snows, 0..1. The mode is picked in the main menu:
// auto keeps a light snowfall with a blizzard now and then, snow and blizzard hold steady, clear stops it.

const LEVEL = { clear: 0, snow: 0.65, blizzard: 1 };

export class Snowfall {
  // getMode() returns auto | snow | blizzard | clear
  constructor(getMode) {
    this.getMode = getMode;
    this.storm = Math.random() < 0.35;
    this.target = this.storm ? 0.4 + Math.random() * 0.6 : 0;
    this.storminess = this.target;
    this.timer = this.storm ? 120 + Math.random() * 240 : 90 + Math.random() * 240;
    this.swell = Math.random() * 100;
    this.level = this.goal();
  }

  // the level the snowfall is heading to
  goal() {
    const mode = this.getMode();
    return mode in LEVEL ? LEVEL[mode] : 0.3 + 0.7 * this.storminess;
  }

  // jump straight to the goal: arriving in the middle of a snowfall, not before it starts
  settle() {
    this.level = this.goal();
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.storm = !this.storm;
      // blizzards last 2.5 to 8 minutes, calm spells 4 to 12 minutes
      this.timer = this.storm ? 150 + Math.random() * 330 : 240 + Math.random() * 480;
      this.target = this.storm ? 0.35 + Math.random() * 0.65 : 0;
    }
    // a blizzard breathes a little: stronger and weaker gusts of snow
    this.swell += dt;
    const breathe = this.storm ? 0.85 + 0.15 * Math.sin(this.swell * 0.11) * Math.sin(this.swell * 0.037) : 1;
    const goal = this.target * breathe;
    this.storminess += (goal - this.storminess) * Math.min(1, dt / 20);
    if (this.storminess < 0.002 && goal === 0) this.storminess = 0;
    this.level += (this.goal() - this.level) * Math.min(1, dt / 8);
  }
}
