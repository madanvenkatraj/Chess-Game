/**
 * spectatorBoot.js — browser bridge for the spectator domain module.
 * ES modules cannot attach to window from a classic script, so this imports
 * the pure module and exposes it as window.Spectator for app.js, mirroring
 * tournamentBoot/friendsBoot/leaderboardBoot.
 */
import {
  SPECTATOR_VERSION, FOLLOW_BOTH, FOLLOW_WHITE, FOLLOW_BLACK,
  SpectatorDataError, normalizeSnapshot, isValidListEntry, sortGameList,
  updateGameList, normalizeFollow, boardOrientation, followedSeat, createReplay,
  createFeed
} from '../spectator/spectator.js';

window.Spectator = {
  VERSION: SPECTATOR_VERSION,
  FOLLOW_BOTH: FOLLOW_BOTH,
  FOLLOW_WHITE: FOLLOW_WHITE,
  FOLLOW_BLACK: FOLLOW_BLACK,
  SpectatorDataError: SpectatorDataError,
  normalizeSnapshot: normalizeSnapshot,
  isValidListEntry: isValidListEntry,
  sortGameList: sortGameList,
  updateGameList: updateGameList,
  normalizeFollow: normalizeFollow,
  boardOrientation: boardOrientation,
  followedSeat: followedSeat,
  createReplay: createReplay,
  createFeed: createFeed
};
