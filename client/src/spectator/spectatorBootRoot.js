/**
 * spectatorBootRoot.js — synchronous ES-module boot for Spectator Mode.
 * app.js is a classic script that runs before async module boots, so the
 * window.Spectator bridge must exist before it parses. This file imports the
 * pure domain module and publishes it on window immediately.
 */
import {
  SPECTATOR_VERSION, FOLLOW_BOTH, FOLLOW_WHITE, FOLLOW_BLACK,
  SpectatorDataError, normalizeSnapshot, isValidListEntry, sortGameList,
  updateGameList, normalizeFollow, boardOrientation, followedSeat, createReplay,
  createFeed
} from './spectator.js';

window.Spectator = {
  VERSION: SPECTATOR_VERSION,
  FOLLOW_BOTH, FOLLOW_WHITE, FOLLOW_BLACK,
  SpectatorDataError,
  normalizeSnapshot, isValidListEntry, sortGameList, updateGameList,
  normalizeFollow, boardOrientation, followedSeat, createReplay, createFeed
};
