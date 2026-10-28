/**
 * Browser bootstrap for the tournament module. ES-module loading means
 * tournament.js cannot attach itself to window directly from app.js (which is
 * a classic script), so this bridge imports the pure module and exposes it.
 * app.js consumes it as window.Tournament.
 */
import {
  createTournament, reportMatchResult, getCurrentMatch, getChampion,
  matchWinnerName, roundName, recomputeBracket,
  serializeTournament, deserializeTournament,
  saveTournament, loadTournament, clearSavedTournament,
  MIN_PLAYERS, MAX_PLAYERS, TournamentDeserializationError
} from './tournament.js';

window.Tournament = {
  createTournament: createTournament,
  reportMatchResult: reportMatchResult,
  getCurrentMatch: getCurrentMatch,
  getChampion: getChampion,
  matchWinnerName: matchWinnerName,
  roundName: roundName,
  recomputeBracket: recomputeBracket,
  serializeTournament: serializeTournament,
  deserializeTournament: deserializeTournament,
  saveTournament: saveTournament,
  loadTournament: loadTournament,
  clearSavedTournament: clearSavedTournament,
  MIN_PLAYERS: MIN_PLAYERS,
  MAX_PLAYERS: MAX_PLAYERS,
  TournamentDeserializationError: TournamentDeserializationError
};
