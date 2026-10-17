# Contributing to Stillwave Trace

Pull requests are welcome. Fork the repository, make your change on a branch, and open a pull request against `main`.

- The maintainer reviews every pull request and merges it. Nothing lands on `main` without that review.
- Say which edition your change touches (`handheld/`, `desktop/`, or both) and what you tested it on. A Raspberry Pi 4 is the reference hardware.
- Keep changes small and focused. Shell scripts should pass `bash -n`, and Python files should pass `python3 -m py_compile`.
- Never include secrets: signing keys, passwords, Wi-Fi details or device serials.
- By contributing you agree that your work is licensed under the Apache License 2.0, the same as the rest of the project (see `LICENSE`).

Bug reports and ideas are welcome as GitHub issues.
