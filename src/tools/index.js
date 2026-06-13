'use strict';

const vec3 = require('vec3');
const { goals, Movements } = require('mineflayer-pathfinder');

// Shared dependencies injected into tools that need them
const deps = { vec3, goals, Movements };

// --- Tools requiring no deps ---
const sendMessage = require('./send_message')(deps);
const endLoop = require('./end_loop')();
const findBlock = require('./find_block')();
const takeScreenshot = require('./take_screenshot')();
const lookAtPlayer = require('./look_at_player')();
const getSurroundings = require('./get_surroundings')();
const remember = require('./remember')();
const listTools = require('./list_tools')();
const dropItem = require('./drop_item')();
const getInventory = require('./get_inventory')();
const getHealthStatus = require('./get_health_status')();
const getActiveEffects = require('./get_active_effects')();
const move = require('./move')();
const jump = require('./jump')();
const cancelFollow = require('./cancel_follow')();
const lockView = require('./lock_view')();
const cancelLockView = require('./cancel_lock_view')();
const craft = require('./craft')();
const smelt = require('./smelt')();
const getRecipe = require('./get_recipe')();
const equip = require('./equip')();
const holdItem = require('./hold_item')();
const openChest = require('./open_chest')();
const depositItem = require('./deposit_item')();
const withdrawItem = require('./withdraw_item')();

// --- Tools requiring vec3 ---
const breakBlock = require('./break_block')(deps);
const placeBlock = require('./place_block')(deps);
const interact = require('./interact')(deps);
const scanArea = require('./scan_area')(deps);
const createWorkbench = require('./create_workbench')(deps);

// --- Tools requiring vec3 + goals + Movements ---
const goTo = require('./go_to')(deps);
const followPlayer = require('./follow_player')(deps);
const goToY = require('./go_to_y')(deps);
const approach = require('./approach')(deps);
const gotoPlayer = require('./goto_player')(deps);
const collectDrops = require('./collect_drops')(deps);
const mineBlockType = require('./mine_block_type')(deps);
const attackEntity = require('./attack_entity')(deps);
const defenceMode = require('./defence_mode')(deps);

const ALL_TOOLS = [
  sendMessage,
  endLoop,
  takeScreenshot,
  lookAtPlayer,
  getSurroundings,
  remember,
  listTools,
  dropItem,
  getInventory,
  getHealthStatus,
  getActiveEffects,
  breakBlock,
  placeBlock,
  interact,
  goTo,
  move,
  jump,
  followPlayer,
  cancelFollow,
  goToY,
  approach,
  findBlock,
  scanArea,
  lockView,
  cancelLockView,
  gotoPlayer,
  collectDrops,
  mineBlockType,
  createWorkbench,
  craft,
  smelt,
  getRecipe,
  equip,
  holdItem,
  openChest,
  depositItem,
  withdrawItem,
  attackEntity,
  defenceMode,
];

function registerTools(registry, config) {
  for (const tool of ALL_TOOLS) {
    registry.register(tool);
  }
}

const makeChatSender = require('./send_message').makeChatSender;

module.exports = { registerTools, makeChatSender };
