const DECK_SELECTION_KEY = "neuroStudySelectedDeck_v1";
const API_CONFIG_KEY = "neuroStudyApiConfig_v3";
const IMPORTED_QUESTIONS_KEY_BASE = "neuroStudyImportedQuestions_v1";
const LEGACY_PROGRESS_KEY_V2_BASE = "neuroStudyProgressV2";
const LEGACY_PROGRESS_KEY_V1_BASE = "neuroStudyProgress_v1";
const LEGACY_ONGOING_TEST_KEY_BASE = "neuroStudyOngoingTest_v1";

function deckScopedKey(baseKey, deckId){
  return `${baseKey}_${deckId}`;
}

function readLegacyProgressRaw(deckId){
  const rawV2 = localStorage.getItem(deckScopedKey(LEGACY_PROGRESS_KEY_V2_BASE, deckId));
  const rawV1 = localStorage.getItem(deckScopedKey(LEGACY_PROGRESS_KEY_V1_BASE, deckId));
  return {rawV2, rawV1};
}

function hasLegacyProgress(deckId){
  const {rawV2, rawV1} = readLegacyProgressRaw(deckId);
  return !!(rawV2 || rawV1);
}

function clearLegacyProgress(deckId){
  localStorage.removeItem(deckScopedKey(LEGACY_PROGRESS_KEY_V2_BASE, deckId));
  localStorage.removeItem(deckScopedKey(LEGACY_PROGRESS_KEY_V1_BASE, deckId));
  localStorage.removeItem(deckScopedKey(LEGACY_ONGOING_TEST_KEY_BASE, deckId));
}

function findLegacyImportedQuestionKeys(){
  const keys = [];
  for(let i = 0; i < localStorage.length; i += 1){
    const key = localStorage.key(i);
    if(!key) continue;
    if(key.startsWith(IMPORTED_QUESTIONS_KEY_BASE)){
      keys.push(key);
    }
  }
  return keys;
}

function hasLegacyImportedQuestions(){
  return findLegacyImportedQuestionKeys().length > 0;
}

function clearLegacyImportedQuestions(){
  findLegacyImportedQuestionKeys().forEach(key => localStorage.removeItem(key));
}

function clearLegacyAppConfig(){
  localStorage.removeItem(DECK_SELECTION_KEY);
  localStorage.removeItem(API_CONFIG_KEY);
}

export {
  readLegacyProgressRaw,
  hasLegacyProgress,
  clearLegacyProgress,
  hasLegacyImportedQuestions,
  clearLegacyImportedQuestions,
  clearLegacyAppConfig
};
