/**
 * Browser bootstrap for the training module (same pattern as tournamentBoot):
 * ES-module loading cannot attach to window from a classic script, so this
 * bridge imports the pure module and exposes it as window.Training for app.js.
 */
import {
  EXERCISES, SKILLS, SKILL_LABELS, DIFFICULTIES, TRAINING_VERSION, TRAINING_KEY,
  getExercise, listBySkill, listByDifficulty,
  deserializeProgress, serializeProgress, saveProgress, loadProgress, clearProgress,
  scoreAttempt, recordCompletion, allCompleted, TrainingDeserializationError
} from './training.js';

window.Training = {
  EXERCISES: EXERCISES,
  SKILLS: SKILLS,
  SKILL_LABELS: SKILL_LABELS,
  DIFFICULTIES: DIFFICULTIES,
  TRAINING_VERSION: TRAINING_VERSION,
  TRAINING_KEY: TRAINING_KEY,
  getExercise: getExercise,
  listBySkill: listBySkill,
  listByDifficulty: listByDifficulty,
  deserializeProgress: deserializeProgress,
  serializeProgress: serializeProgress,
  saveProgress: saveProgress,
  loadProgress: loadProgress,
  clearProgress: clearProgress,
  scoreAttempt: scoreAttempt,
  recordCompletion: recordCompletion,
  allCompleted: allCompleted,
  TrainingDeserializationError: TrainingDeserializationError
};
