const { NBS, INSTBE } = require("../main.js")
  , MCS = require("mcstructure-js")
  , PMR = require("project-mirror-registry")
  , fs = require("fs")
  , pl = require("path")
  , ps = require("process");

function toArrayBuffer(buf) {
  var ab = new ArrayBuffer(buf.length);
  (new Uint8Array(ab)).set(buf);
  return ab;
}

if (!ps.argv[2] || !ps.argv[3])
  throw Error("invalid params");

const SONG_NAME = ps.argv[3];
const FILE_NAME = ps.argv[2];
const EXE_TARGET = `@a[tag=song.${SONG_NAME}]`;
const EXE_TMR = `tick.${SONG_NAME} generic.song`;
const MAX_DUP_LIMIT = 4;

var r = fs.readFileSync(pl.join(__dirname, FILE_NAME));
var s = NBS.deserialize(toArrayBuffer(r), 0);

function buildHash(noteblock, sameCount) {
  return noteblock.instrument + "/" + noteblock.key + "/" + sameCount;
}

function expandHash(hash) {
  var s = hash.split("/");
  return {
    instrument: Number(s[0]),
    key: Number(s[1])
  }
}

function toPlaySound(note) {
  return `playsound ${INSTBE[note.instrument]} @s ~~~ 1.0 ${Math.pow(2, (note.key - 45) / 12)}`
}

function toCommands(nbs, maxLen = 2000) {
  function commandBegin() {
    return ["execute as", EXE_TARGET].join(" ") + " ";
  }

  function commandSegment(range) {
    return ["unless", "score", EXE_TMR, "matches", range].join(" ") + " ";
  }

  function commandEnd(payload) {
    return ["at", "@s", "run", payload].join(" ");
  }

  function buildRange(min, max) {
    var result = "";
    if (typeof min == "number")
      result += min;
    result += "..";
    if (typeof max == "number")
      result += max;
    return result;
  }

  var notes = new Map()
    , commands = [];

  // Get note ticks from nbs.
  for (var a of nbs.effectiveTicks) {
    var gametick = Math.round(nbs.getTimeGtFor(a.tick))
      , tickNoteDup = {};

    for (var b of a.notes) {
      var hash = buildHash(b, 1)
        , dupCount;

      if (tickNoteDup[hash]) {
        if (tickNoteDup[hash] >= MAX_DUP_LIMIT)
          continue;
        dupCount = tickNoteDup[hash] + 1;
        tickNoteDup[hash] = dupCount;
        hash = buildHash(b, dupCount);
      } else
        tickNoteDup[hash] = 1;

      if (!notes.has(hash))
        notes.set(hash, []);
      notes.get(hash).push(gametick);
    }
  }

  for (var kv of notes.entries()) {
    var note = expandHash(kv[0])
      , ticks = kv[1]
      , command = commandBegin()
      , time = -1;

    for (var tick of ticks) {
      if (tick == 0 || (tick != time + 1 && tick != time)) {
        command += commandSegment(buildRange(
          time == -1 || time + 1,
          tick - 1));
      }

      time = tick;

      if (command.length > maxLen) {
        command += commandSegment(buildRange(time + 1));
        command += commandEnd(toPlaySound(note));

        commands.push(command);

        command = commandBegin();
        time = -1;
      }
    }

    command += commandSegment(buildRange(time + 1));
    command += commandEnd(toPlaySound(note));
    commands.push(command);
  }

  return commands;
}

function createCommandBlock(command, type, direction) {
  var block = PMR.createUniversalTag("block")
    , blockEntity;

  block.name = [
    "minecraft:command_block",
    "minecraft:repeating_command_block",
    "minecraft:chain_command_block"
  ][type];
  block.states["i32>facing_direction"] = direction;

  blockEntity = PMR.createBlockEntity(block.name);

  blockEntity.Command = command;
  blockEntity.auto = type == 2 ? 1 : 0;
  blockEntity.conditionalMode = 0;
  blockEntity.conditionMet = 1;
  blockEntity.LPConditionalMode = 0;
  blockEntity.LPRedstoneMode = type == 2 ? 0 : 1;

  return {
    block,
    blockEntity
  };
}

function toMCS(commands) {
  var basicSideLen = [4, 4, 4]
    , expand = 0;

  while (commands.length > (basicSideLen[0] * basicSideLen[1] * basicSideLen[2])) {
    basicSideLen[expand] *= 2;
    expand++;
    expand %= 3;
  }

  var structure = new MCS(basicSideLen[0], basicSideLen[1], basicSideLen[2])
    , head = true
    , cursor = { x: 0, y: 0, z: 0 };

  for (var i = 0; i < commands.length; i++) {
    var block = createCommandBlock(commands[i], head ? 1 : 2, 1);
    head && (head = false);

    structure.setBlock(cursor, block.block);
    structure.setBlockData(cursor, block.blockEntity);

    cursor.y++;
    if (cursor.y >= basicSideLen[1]) {
      cursor.y = 0;
      cursor.z++;
      head = true;
    }
    if (cursor.z == basicSideLen[2]) {
      cursor.z = 0;
      cursor.x++;
    }
  }

  return structure
}

var commands = toCommands(s);

fs.writeFileSync(pl.join(__dirname, SONG_NAME + ".txt"), commands.join("\n"));

console.log(commands.length)
var structure = toMCS(commands);

fs.writeFileSync(pl.join(__dirname, SONG_NAME + ".mcstructure"), Buffer.from(structure.serialize()));
