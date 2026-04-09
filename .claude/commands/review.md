Review recently changed files. For each file check:

1. Is it under 500 lines? If not, suggest how to split.
2. Are all functions under 30 lines? If not, suggest extraction.
3. Does every function have a JSDoc comment?
4. Are Zod schemas used for data validation?
5. Is error handling using Result<T,E>, not throw?
6. Are there tests? Do they cover happy path + error cases?
7. Run: !`git diff --stat HEAD~1`