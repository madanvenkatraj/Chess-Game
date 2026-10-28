/**
 * Browser bootstrap for the friends module. ES-module loading means friends.js
 * cannot attach itself to window directly from app.js (a classic script), so
 * this bridge imports the pure module and exposes it as window.Friends.
 */
import {
  FRIENDS_VERSION, FRIENDS_KEY, CODE_RE, MAX_FRIENDS, MAX_NAME,
  FriendsDeserializationError,
  generatePlayerCode, normalizeCode, sanitizeUsername,
  addFriend, removeFriend, findFriend, searchFriends, updateFriendRating,
  createChallenge, friendStats,
  serializeFriends, deserializeFriends, saveFriends, loadFriends, clearFriends
} from './friends.js';

window.Friends = {
  FRIENDS_VERSION, FRIENDS_KEY, CODE_RE, MAX_FRIENDS, MAX_NAME,
  FriendsDeserializationError,
  generatePlayerCode, normalizeCode, sanitizeUsername,
  addFriend, removeFriend, findFriend, searchFriends, updateFriendRating,
  createChallenge, friendStats,
  serializeFriends, deserializeFriends, saveFriends, loadFriends, clearFriends
};
