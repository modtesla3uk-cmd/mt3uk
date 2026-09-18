"""Shared R2 (S3-compatible) client used by the gallery and track days
manifest builders, now that photos live in the mt3uk-gallery R2 bucket
instead of the git repo.

Credentials come from the R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars
(set as GitHub Actions secrets in CI). The account ID and bucket name
aren't secret, they're baked in below.
"""
import os

import boto3

ACCOUNT_ID = "a3b25c36e9d63f1b4ea24749a23781ee"
BUCKET = "mt3uk-gallery"
PUBLIC_BASE_URL = "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev"


def get_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def list_objects(client, prefix: str):
    """Yields every object under `prefix` in the bucket, handling pagination."""
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            yield obj
