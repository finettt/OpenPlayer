'use strict';

module.exports = function () {
  return {
    name: 'todo',
    description:
      'Manage a persistent task list. Use "add" to create tasks for multi-step goals, ' +
      '"start" when beginning a task, "complete" when done, "list" to see all tasks, ' +
      '"remove" to delete a task, and "clear" to remove completed tasks. ' +
      'Tasks survive restarts. Your current tasks are shown in every reasoning step.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'list', 'start', 'complete', 'remove', 'clear'],
          description:
            'Action to perform: add a task, list all tasks, mark as started, ' +
            'mark as completed, remove a task, or clear completed/all tasks.',
        },
        text: {
          type: 'string',
          description: 'Task description (required for "add" action).',
        },
        id: {
          type: 'integer',
          description: 'Task ID (required for "start", "complete", "remove" actions).',
        },
        completed_only: {
          type: 'boolean',
          description:
            'For "clear" action: true to clear only completed tasks (default), ' +
            'false to clear ALL tasks.',
        },
      },
      required: ['action'],
    },
    async execute(args, ctx) {
      const { action } = args;

      switch (action) {
        case 'add': {
          if (!args.text || !args.text.trim()) {
            return 'Error: "text" is required for add action.';
          }
          return ctx.session.todoAction('add', { text: args.text.trim() });
        }
        case 'list': {
          return ctx.session.todoAction('list');
        }
        case 'start': {
          if (args.id == null) {
            return 'Error: "id" is required for start action.';
          }
          return ctx.session.todoAction('start', { id: args.id });
        }
        case 'complete': {
          if (args.id == null) {
            return 'Error: "id" is required for complete action.';
          }
          return ctx.session.todoAction('complete', { id: args.id });
        }
        case 'remove': {
          if (args.id == null) {
            return 'Error: "id" is required for remove action.';
          }
          return ctx.session.todoAction('remove', { id: args.id });
        }
        case 'clear': {
          const completedOnly = args.completed_only !== false;
          return ctx.session.todoAction('clear', { completedOnly });
        }
        default:
          return `Error: unknown action "${action}".`;
      }
    },
  };
};