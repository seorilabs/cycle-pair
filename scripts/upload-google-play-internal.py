#!/usr/bin/env python3
import argparse
import json
import os
import sys
import warnings
from pathlib import Path


warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
    module=r"google\.(auth|oauth2|api_core)(\.|$)",
)

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "play-store" / "google-play.config.json"
ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
DEFAULT_API_TIMEOUT_SECONDS = 300
DEFAULT_API_RETRIES = 5


def load_config():
    with CONFIG_PATH.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def env_int(name, default, minimum=None):
    raw_value = os.environ.get(name)
    if raw_value in (None, ""):
        return default
    try:
        parsed = int(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer.") from error
    if minimum is not None and parsed < minimum:
        raise RuntimeError(f"{name} must be {minimum} or greater.")
    return parsed


def positive_int(value):
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return parsed


def non_negative_int(value):
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be 0 or greater")
    return parsed


def make_android_publisher(timeout_seconds):
    try:
        import google.auth
        import google_auth_httplib2
        import httplib2
        from googleapiclient.discovery import build
    except ImportError as error:
        raise RuntimeError(
            "Install google-api-python-client, google-auth, "
            "google-auth-httplib2, and httplib2."
        ) from error

    credentials, _project_id = google.auth.default(
        scopes=[ANDROID_PUBLISHER_SCOPE]
    )
    base_http = httplib2.Http(timeout=timeout_seconds)
    try:
        base_http.redirect_codes = base_http.redirect_codes - {308}
    except AttributeError:
        pass
    http = google_auth_httplib2.AuthorizedHttp(credentials, http=base_http)
    return build("androidpublisher", "v3", http=http, cache_discovery=False)


def execute_request(request, retries):
    return request.execute(num_retries=retries)


def changes_not_sent_for_review_rejected(error):
    return "changesNotSentForReview must not be set" in str(error)


def default_release_notes(release_config, language):
    notes = release_config.get("releaseNotes", {})
    if not isinstance(notes, dict):
        return ""
    if notes.get(language):
        return notes[language]
    return next((value for value in notes.values() if value), "")


def resolve_track(publisher, package_name, edit_id, requested_track, retries):
    response = execute_request(
        publisher.edits()
        .tracks()
        .list(packageName=package_name, editId=edit_id),
        retries,
    )
    available = {track.get("track") for track in response.get("tracks", [])}
    if requested_track in available:
        return requested_track
    alias = {"internal": "qa", "qa": "internal"}.get(requested_track)
    return alias if alias in available else requested_track


def upload_internal_release(args):
    aab_path = Path(args.aab_path).resolve()
    if not args.package_name or "확정 필요" in args.package_name:
        raise RuntimeError("Google Play package name is required.")
    if not aab_path.is_file():
        raise FileNotFoundError(f"AAB file does not exist: {aab_path}")
    if not args.release_notes:
        raise RuntimeError("Release notes are required.")
    if len(args.release_notes) > 500:
        raise RuntimeError("Google Play release notes must be 500 characters or fewer.")

    publisher = make_android_publisher(args.api_timeout_seconds)
    edit = execute_request(
        publisher.edits().insert(packageName=args.package_name, body={}),
        args.api_retries,
    )
    edit_id = edit["id"]
    try:
        from googleapiclient.http import MediaFileUpload

        track = resolve_track(
            publisher,
            args.package_name,
            edit_id,
            args.track,
            args.api_retries,
        )
        bundle = execute_request(
            publisher.edits()
            .bundles()
            .upload(
                packageName=args.package_name,
                editId=edit_id,
                media_body=MediaFileUpload(
                    str(aab_path),
                    mimetype="application/octet-stream",
                    chunksize=16 * 1024 * 1024,
                    resumable=True,
                ),
            ),
            args.api_retries,
        )
        version_code = int(bundle["versionCode"])
        release = {
            "name": args.release_name,
            "versionCodes": [str(version_code)],
            "status": args.release_status,
            "releaseNotes": [
                {
                    "language": args.release_notes_language,
                    "text": args.release_notes,
                }
            ],
        }
        execute_request(
            publisher.edits()
            .tracks()
            .update(
                packageName=args.package_name,
                editId=edit_id,
                track=track,
                body={"track": track, "releases": [release]},
            ),
            args.api_retries,
        )

        commit_arguments = {
            "packageName": args.package_name,
            "editId": edit_id,
        }
        if args.changes_not_sent_for_review:
            commit_arguments["changesNotSentForReview"] = True
        try:
            committed = execute_request(
                publisher.edits().commit(**commit_arguments),
                args.api_retries,
            )
        except Exception as commit_error:
            if (
                not args.changes_not_sent_for_review
                or not changes_not_sent_for_review_rejected(commit_error)
            ):
                raise
            commit_arguments.pop("changesNotSentForReview", None)
            committed = execute_request(
                publisher.edits().commit(**commit_arguments),
                args.api_retries,
            )

        return {
            "packageName": args.package_name,
            "requestedTrack": args.track,
            "track": track,
            "releaseStatus": args.release_status,
            "versionCode": version_code,
            "editId": committed["id"],
        }
    except Exception:
        try:
            execute_request(
                publisher.edits().delete(
                    packageName=args.package_name,
                    editId=edit_id,
                ),
                args.api_retries,
            )
        except Exception as cleanup_error:
            print(
                f"Warning: failed to delete Google Play edit {edit_id}: "
                f"{cleanup_error}",
                file=sys.stderr,
            )
        raise


def main():
    config = load_config()
    release_config = config.get("release", {})
    default_language = config.get("defaultLanguage", "ko-KR")

    parser = argparse.ArgumentParser(
        description="Upload a signed AAB to Google Play internal testing."
    )
    parser.add_argument("--package-name", default=config.get("packageName"))
    parser.add_argument("--aab-path", required=True)
    parser.add_argument("--track", choices=["internal"], default="internal")
    parser.add_argument(
        "--release-status",
        choices=["draft", "completed"],
        default="draft",
    )
    parser.add_argument("--release-name", required=True)
    parser.add_argument("--release-notes-language", default=default_language)
    parser.add_argument(
        "--release-notes",
        default=default_release_notes(release_config, default_language),
    )
    parser.add_argument("--changes-not-sent-for-review", action="store_true")
    parser.add_argument(
        "--api-timeout-seconds",
        type=positive_int,
        default=env_int(
            "GOOGLE_PLAY_API_TIMEOUT_SECONDS",
            DEFAULT_API_TIMEOUT_SECONDS,
            minimum=1,
        ),
    )
    parser.add_argument(
        "--api-retries",
        type=non_negative_int,
        default=env_int(
            "GOOGLE_PLAY_API_RETRIES",
            DEFAULT_API_RETRIES,
            minimum=0,
        ),
    )
    args = parser.parse_args()

    try:
        result = upload_internal_release(args)
    except Exception as error:
        print(f"Google Play internal upload failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
