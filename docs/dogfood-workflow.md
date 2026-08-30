# PushStack dogfood workflow

This change exists to exercise PushStack's real issue and pull-request flow:

- create and comment on an issue;
- close and reopen it;
- open, comment on, close, reopen, and merge a pull request.

Merging a pull request with an explicit `Closes #3` reference also closes the
matching issue in the same repository.

The workflow is intentionally documentation-only so the end-to-end check does
not alter runtime behavior.
