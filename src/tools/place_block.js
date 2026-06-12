'use strict';

module.exports = function ({ vec3 }) {
  return {
    name: 'place_block',
    description:
      'Place the currently held block item on a face of an adjacent block. ' +
      'Use for building, bridging, placing torches, etc. ' +
      'Face is relative to the reference block: north/south/east/west/up/down.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Reference block X coordinate (adjacent to where block will be placed).' },
        y: { type: 'number', description: 'Reference block Y coordinate.' },
        z: { type: 'number', description: 'Reference block Z coordinate.' },
        face: {
          type: 'string',
          enum: ['up', 'down', 'north', 'south', 'east', 'west'],
          description: 'Face of the reference block to place on. Defaults to up.',
        },
      },
      required: ['x', 'y', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const pos = vec3(args.x, args.y, args.z);
      const block = bot.blockAt(pos);
      if (!block) {
        return `No block found at x=${args.x}, y=${args.y}, z=${args.z}.`;
      }

      const heldItem = bot.heldItem;
      if (!heldItem) {
        return 'Error: no item held. Select a block item in hotbar first.';
      }

      const faceMap = {
        up: vec3(0, 1, 0),
        down: vec3(0, -1, 0),
        north: vec3(0, 0, -1),
        south: vec3(0, 0, 1),
        east: vec3(1, 0, 0),
        west: vec3(-1, 0, 0),
      };
      const face = faceMap[args.face ?? 'up'] || vec3(0, 1, 0);

      // Check target space is empty
      const targetPos = pos.plus(face);
      const targetBlock = bot.blockAt(targetPos);
      if (targetBlock && targetBlock.name !== 'air') {
        return `Cannot place block: ${targetBlock.name} already at target position.`;
      }

      try {
        await bot.placeBlock(block, face);
        return `Placed ${heldItem.name} at x=${targetPos.x}, y=${targetPos.y}, z=${targetPos.z}.`;
      } catch (err) {
        return `Failed to place block: ${err.message}`;
      }
    },
  };
};
