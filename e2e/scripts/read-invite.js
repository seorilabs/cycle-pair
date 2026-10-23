output.invitation = JSON.parse(http.get(MAESTRO_CONTROL_URL + '/invitation').body).code;
