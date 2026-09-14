class CommandStringBuilder {
  static toEscaped(s) {
    var result = "";
    for (var ch of s) {
      if (ch == "\\")
        result += "\\\\";
      else if (ch == "\"")
        result += "\\\"";
      else
        result += ch;
    }
    return result;
  }
  static toStringLiteral(s) {
    return `"${CommandStringBuilder.toEscaped(s)}"`;
  }
  constructor() { }
  finalize() { return ""; }
  estimate() { return this.finalize().length; }
  toString() { return this.finalize(); }
}

class ScoreRange extends CommandStringBuilder {
  static kScoreMin = -2147483648;
  static kScoreMax = 2147483647;

  static copy(range) {
    return new ScoreRange(range.min, range.max);
  }

  constructor(a = 0, b = 0) {
    super();

    a |= 0;
    b |= 0;

    var min = Math.min(a, b)
      , max = Math.max(a, b);

    this.min = min;
    this.max = max;
  }

  isPoint() {
    return this.min == this.max;
  }

  isValid() {
    return this.min != ScoreRange.kScoreMin && this.max != ScoreRange.kScoreMax;
  }

  finalize() {
    if (this.isPoint())
      return this.min.toString();
    if (this.min == ScoreRange.kScoreMin)
      return `..${this.max}`;
    if (this.max == ScoreRange.kScoreMax)
      return `${this.min}..`;
    return `${this.min}..${this.max}`;
  }
}

class ScoreboardRef extends CommandStringBuilder {
  static copy(range) {
    return new ScoreRange(range.objective, range.name);
  }

  constructor(objective, name) {
    super();
    this.objective = objective + "";
    this.name = name;
  }

  finalize() {
    if (this.name instanceof CommandStringBuilder)
      return `${this.name.finalize()} ${CommandStringBuilder.toStringLiteral(this.objective)}`;
    return `${CommandStringBuilder.toStringLiteral(this.name.finalize())} ${CommandStringBuilder.toStringLiteral(this.objective)}`;
  }
}

class SelectorBuilder extends CommandStringBuilder {
  constructor() {
    super();
    this.base = "@e";
    this.conditions = [];
    this.scores = [];
  }

  setBase(s) {
    this.base = s;
  }

  addSimpleCondition(name, value) {
    this.conditions.push({ name, value });
  }

  addScoreRange(objective, range) {
    this.scores.push({ objective, range });
  }

  finalize() {
    var result = `${this.base}`;
    if (!this.conditions.length && !this.scores.length)
      return result;

    var filters = `${this.conditions.map(v => v.name + "=" + v.value).join(",")}`;
    if (this.conditions.length && this.scores.length)
      filters += ",";
    if (this.scores.length)
      filters += `scores={${this.scores.map(v => v.objective + "=" + v.range).join(",")}}`;

    return result + "[" + filters + "]";
  }
}

class ExecuteSubcommand extends CommandStringBuilder { }

class ExecuteConditionSubcommand extends ExecuteSubcommand {
  constructor(unless = false) {
    super();
    this.unless = !!unless;
  }

  finalize() {
    return super.finalize() + (this.unless ? "unless" : "if");
  }
}

class ExecuteAsSubcommand extends ExecuteSubcommand {
  constructor(selector) {
    super();
    this.selector = selector;
  }

  setSelector(selector) {
    this.selector = selector;
    return this;
  }

  finalize() {
    const selectorStr = this.selector instanceof SelectorBuilder
      ? this.selector.finalize()
      : String(this.selector);
    return `as ${selectorStr}`;
  }
}

class ExecuteAtSubcommand extends ExecuteSubcommand {
  constructor(selector = "@s") {
    super();
    this.selector = selector;
  }

  setSelector(selector) {
    this.selector = selector;
    return this;
  }

  finalize() {
    const selectorStr = this.selector instanceof SelectorBuilder
      ? this.selector.finalize()
      : String(this.selector);
    return `at ${selectorStr}`;
  }
}

class ExecutePositionedSubcommand extends ExecuteSubcommand {
  constructor(x, y, z) {
    super();
    this.x = x;
    this.y = y;
    this.z = z;
  }

  setPosition(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  finalize() {
    return `positioned ${this.x} ${this.y} ${this.z}`;
  }
}

class ExecuteScoreSubcommand extends ExecuteConditionSubcommand {
  constructor(unless = false) {
    super(unless);
    this.range = new ScoreRange();
    this.scoreboard = new ScoreboardRef();
  }

  setRange(range) {
    this.range = ScoreRange.copy(range);
  }

  setScoreboard(scoreboard) {
    this.scoreboard = ScoreboardRef.copy(scoreboard);
  }

  finalize() {
    //if (!this.range.isValid() && !this.unless)
    //  return "";
    return `${super.finalize()} score ${this.scoreboard.finalize()} matches ${this.range.finalize()}`;
  }
}

class ExecuteCommandBuilder extends CommandStringBuilder {
  constructor() {
    super();
    this.subcommands = [];
    this.runCommand = "";
  }

  addSubcommand(subcommand) {
    if (subcommand instanceof ExecuteSubcommand) {
      this.subcommands.push(subcommand);
    }
    return this;
  }

  setRunCommand(command) {
    this.runCommand = command + "";
    return this;
  }

  finalize() {
    let result = "execute";

    for (const sub of this.subcommands) {
      const finalized = sub.finalize();
      if (finalized) {
        result += " " + finalized;
      }
    }

    if (this.runCommand) {
      result += " run " + this.runCommand;
    }

    return result;
  }
}

class TellrawCommandBuilder extends CommandStringBuilder {
  constructor(target = "@a") {
    super();
    this.target = target;
    this.rawtext = [];
  }

  setTarget(target) {
    this.target = target + "";
    return this;
  }

  addText(text, color = null) {
    const component = { text: text + "" };
    if (color) component.color = color;
    this.rawtext.push(component);
    return this;
  }

  addSelector(selector) {
    this.rawtext.push({ selector: selector + "" });
    return this;
  }

  addScore(name, objective) {
    this.rawtext.push({
      score: {
        name: name + "",
        objective: objective + ""
      }
    });
    return this;
  }

  addTranslate(key, with_components = []) {
    const component = { translate: key + "" };
    if (with_components.length > 0) {
      component.with = { rawtext: with_components };
    }
    this.rawtext.push(component);
    return this;
  }

  finalize() {
    if (this.rawtext.length === 0) {
      return `tellraw ${this.target} {"rawtext":[]}`;
    }
    return `tellraw ${this.target} ${JSON.stringify({ rawtext: this.rawtext })}`;
  }
}

var a = new SelectorBuilder();
a.addSimpleCondition("tag", "name");
a.addScoreRange("tag", new ScoreRange(10, 1));
console.log(a.finalize())

class ComplementaryScoreRange {
  constructor() {
    this.ranges = [];
  }

  addPoint(value) {
    value |= 0;
    this.ranges.push(new ScoreRange(value, value));
  }

  addClosedInterval(a, b) {
    a |= 0;
    b |= 0;

    var min = Math.min(a, b)
      , max = Math.max(a, b);

    this.ranges.push(new ScoreRange(min, max));
  }

  addLessEqual(value) {
    value |= 0;
    this.ranges.push(new ScoreRange(ScoreRange.kScoreMin, value));
  }

  addGreaterEqual(value) {
    value |= 0;
    this.ranges.push(new ScoreRange(value, ScoreRange.kScoreMax));
  }

  merge() {
    if (this.ranges.length <= 1)
      return this;

    this.ranges.sort((a, b) => (a.min - b.min) || (a.max - b.max));

    var merged = [];
    for (var range of this.ranges) {
      if (merged.length === 0) {
        merged.push(ScoreRange.copy(range));
        continue;
      }

      var last = merged[merged.length - 1];

      if (range.min <= last.max + 1) {
        if (range.max > last.max) {
          last.max = range.max;
        }
      } else {
        merged.push(ScoreRange.copy(range));
      }
    }

    this.ranges = merged;
    return this;
  }

  complement() {
    this.merge();

    var result = []
      , cursor = ScoreRange.kScoreMin;

    for (var range of this.ranges) {
      if (cursor < range.min) {
        result.push(new ScoreRange(cursor, range.min - 1));
      }

      cursor = range.max + 1;

      if (cursor > ScoreRange.kScoreMax) {
        break;
      }
    }

    if (cursor <= ScoreRange.kScoreMax) {
      result.push(new ScoreRange(cursor, ScoreRange.kScoreMax));
    }

    this.ranges = result;
    return this;
  }

  finalize() {
    this.merge();
    return this.ranges.map(range => ScoreRange.copy(range));
  }
}

export {
  CommandStringBuilder,
  ScoreRange,
  ScoreboardRef,
  SelectorBuilder,
  ExecuteSubcommand,
  ExecuteConditionSubcommand,
  ExecuteAsSubcommand,
  ExecuteAtSubcommand,
  ExecutePositionedSubcommand,
  ExecuteScoreSubcommand,
  ExecuteCommandBuilder,
  TellrawCommandBuilder,
  ComplementaryScoreRange,
};
