#!/bin/bash

set -euo pipefail

mode="${1:-}"
if [[ "${mode}" != "validate" && "${mode}" != "embed" ]]; then
  echo "error: Firebase config selector mode must be validate or embed." >&2
  exit 1
fi

: "${PROJECT_DIR:?error: PROJECT_DIR is required}"
: "${CONFIGURATION:?error: CONFIGURATION is required}"
: "${PRODUCT_BUNDLE_IDENTIFIER:?error: PRODUCT_BUNDLE_IDENTIFIER is required}"
: "${FIREBASE_CONFIG_PATH:?error: FIREBASE_CONFIG_PATH is required}"

source_plist="${PROJECT_DIR}/${FIREBASE_CONFIG_PATH}"
if [[ ! -f "${source_plist}" ]]; then
  echo "error: Cycle Pair ${CONFIGURATION} Firebase config is missing at ${FIREBASE_CONFIG_PATH}." >&2
  echo "error: Debug and Release both require the single tracked Firebase plist." >&2
  exit 1
fi

plist_buddy=/usr/libexec/PlistBuddy
project_id="$(${plist_buddy} -c 'Print :PROJECT_ID' "${source_plist}" 2>/dev/null || true)"
bundle_id="$(${plist_buddy} -c 'Print :BUNDLE_ID' "${source_plist}" 2>/dev/null || true)"
google_app_id="$(${plist_buddy} -c 'Print :GOOGLE_APP_ID' "${source_plist}" 2>/dev/null || true)"

if [[ -z "${project_id}" || -z "${bundle_id}" || -z "${google_app_id}" ]]; then
  echo "error: Selected Firebase plist is missing required native app metadata." >&2
  exit 1
fi
if [[ "${bundle_id}" != "${PRODUCT_BUNDLE_IDENTIFIER}" ]]; then
  echo "error: Selected Firebase plist does not target the permanent Cycle Pair bundle ID." >&2
  exit 1
fi

expected_project_id="${FIREBASE_EXPECTED_PROJECT_ID:-}"
if [[ -z "${expected_project_id}" || "${project_id}" != "${expected_project_id}" ]]; then
  echo "error: Firebase plist does not match the single tracked project." >&2
  exit 1
fi

if [[ "${mode}" == "embed" ]]; then
  : "${TARGET_BUILD_DIR:?error: TARGET_BUILD_DIR is required}"
  : "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?error: UNLOCALIZED_RESOURCES_FOLDER_PATH is required}"
  destination="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist"
  /bin/mkdir -p "$(/usr/bin/dirname "${destination}")"
  /bin/cp "${source_plist}" "${destination}"
fi

echo "Cycle Pair ${CONFIGURATION} Firebase configuration ${mode} passed."
