var observation = http.get(MAESTRO_CONTROL_URL + '/account-empty/' + ACCOUNT_FIELD);
if (observation.status !== 200) throw new Error('QA account input observation unavailable');
var result = JSON.parse(observation.body);
if (typeof result.empty !== 'boolean') throw new Error('QA account input observation invalid');
output.accountInputEmpty = result.empty;
