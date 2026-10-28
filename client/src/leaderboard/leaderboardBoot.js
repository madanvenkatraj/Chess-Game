/**
 * Browser bootstrap for the leaderboard module — exposes window.Leaderboard
 * for app.js (a classic script that cannot import ES modules directly).
 */
import {
  LEADERBOARD_VERSION, LEADERBOARD_KEY, WEEK_POINTS, WEEK_MS,
  allTimeLeaderboard, weeklyLeaderboard, weeklyPoints, toLeaderPlayer,
  serializePrefs, deserializePrefs, savePrefs, loadPrefs
} from './leaderboard.js';

window.Leaderboard = {
  LEADERBOARD_VERSION, LEADERBOARD_KEY, WEEK_POINTS, WEEK_MS,
  allTimeLeaderboard, weeklyLeaderboard, weeklyPoints, toLeaderPlayer,
  serializePrefs, deserializePrefs, savePrefs, loadPrefs
};
