"""Local Mac desktop job matcher. Compares a CV to public job postings."""

import warnings

# urllib3 2 warns on the macOS system Python, which is built with LibreSSL.
# requirements.txt pins urllib3<2; this keeps a first launch quiet if an
# older environment still has urllib3 2 installed.
warnings.filterwarnings(
    "ignore",
    message=r"urllib3 v2 only supports OpenSSL",
)

__version__ = "1.0.0"
