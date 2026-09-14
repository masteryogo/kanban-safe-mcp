import type { ToolDef } from './tool.js';
import { whoami } from './whoami.js';
import { getBoardTool } from './get-board.js';
import { findCards } from './find-cards.js';
import { getCardTool } from './get-card.js';
import { getComments } from './get-comments.js';
import { createCardTool } from './create-card.js';
import { updateCardTool } from './update-card.js';
import { moveCardTool } from './move-card.js';
import { addCommentTool } from './add-comment.js';
import { updateCommentTool } from './update-comment.js';
import { setLabels } from './set-labels.js';
import { setMembers } from './set-members.js';
import { addTasks } from './add-tasks.js';
import { updateTaskTool } from './update-task.js';
import { replaceTasks } from './replace-tasks.js';
import { deleteTaskTool } from './delete-task.js';

/** As 16 ferramentas. Cada uma ocupa contexto em toda sessao — a lista e enxuta de proposito. */
export const TOOLS: ToolDef[] = [
  whoami,
  getBoardTool,
  findCards,
  getCardTool,
  getComments,
  createCardTool,
  updateCardTool,
  moveCardTool,
  addCommentTool,
  updateCommentTool,
  setLabels,
  setMembers,
  addTasks,
  updateTaskTool,
  replaceTasks,
  deleteTaskTool,
];
