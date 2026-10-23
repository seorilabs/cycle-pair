// Only actual text copied from the rendered invitation is relayed. The runner
// keeps it in memory and never includes it in the retained evidence.
http.post(MAESTRO_CONTROL_URL + '/invitation', {
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({code: maestro.copiedText})
});
