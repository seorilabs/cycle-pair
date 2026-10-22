output.invitation = JSON.parse(http.get(CONTROL_URL + '/invitation').body).code;
