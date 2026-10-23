try {
  var observation = http.get(MAESTRO_CONTROL_URL + '/record-note-empty');
  if (observation.status !== 200) throw new Error();
  var result = JSON.parse(observation.body);
  if (Object.keys(result).length !== 1 || typeof result.empty !== 'boolean') throw new Error();
  output.recordNoteEmpty = result.empty;
} catch (error) {
  throw new Error('Record note observation unavailable');
}
