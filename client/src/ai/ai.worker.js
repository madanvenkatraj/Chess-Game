import { chooseMove } from './ai.js';

export function handleSearchRequest(request) {
  const result = chooseMove(request.state, request.difficulty);
  return {
    id: request.id,
    move: result.move,
    reason: result.reason,
    difficulty: result.difficulty,
    nodesSearched: result.nodesSearched,
  };
}

if (typeof self !== 'undefined') self.onmessage = (event) => {
  const request = event.data;
  if (!request || typeof request.id !== 'number') return;
  try {
    self.postMessage(handleSearchRequest(request));
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'ai-search-failed',
    });
  }
};
