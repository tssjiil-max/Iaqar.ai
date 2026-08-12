import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_UI_STATE,
  voiceUiVisibility
} from "../public/js/gemini-voice-intake-ui.js";

test("voiceUiVisibility shows stop/cancel only while recording", () => {
  const recording = voiceUiVisibility(VOICE_UI_STATE.RECORDING);
  assert.equal(recording.showRecording, true);
  assert.equal(recording.showErrorActions, false);
  assert.equal(recording.showStart, false);
  assert.equal(recording.blockStart, true);

  const analyzing = voiceUiVisibility(VOICE_UI_STATE.ANALYZING);
  assert.equal(analyzing.showRecording, false);
  assert.equal(analyzing.showErrorActions, false);
  assert.equal(analyzing.showAnalyzingStatus, true);
  assert.equal(analyzing.blockStart, true);

  const error = voiceUiVisibility(VOICE_UI_STATE.ERROR);
  assert.equal(error.showErrorActions, true);
  assert.equal(error.showRecording, false);
  assert.equal(error.showStart, false);

  const idle = voiceUiVisibility(VOICE_UI_STATE.IDLE);
  assert.equal(idle.showStart, true);
  assert.equal(idle.showRecording, false);
  assert.equal(idle.showErrorActions, false);
});

test("stopping state hides recording indicator before analyze", () => {
  const stopping = voiceUiVisibility(VOICE_UI_STATE.STOPPING);
  assert.equal(stopping.showRecording, false);
  assert.equal(stopping.showAnalyzingStatus, true);
});
