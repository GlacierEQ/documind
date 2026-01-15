# AGENTS.md
## Code Style
- Use `nodejs` best practices:
  - Node.js: ESLint with Airbnb style guide, Prettier for formatting.
  - Python: Black (line length 88), PEP 8 compliance.
  - Ruby: RuboCop with default style guide.
- Prefer descriptive variable names (e.g., `user_count` over `usr_cnt`).
- Avoid inline comments; use clear function/docstring comments.

## Testing
- Run tests before commits:
  - Node.js: `vitest run`
  - Python: `pytest tests/`
  - Ruby: `bundle exec rspec`
- Ensure 90%+ test coverage.
- Use mocks for external APIs (e.g., Mock Service Worker for Node.js).

## Pull Request Instructions
- Title format: `[Feature|Fix|Chore] Short description`
- Include a one-line summary and "Testing Done" section in PR description.
- Run linters and formatters before submitting:
  - Node.js: `eslint . && prettier --write .`
  - Python: `black . && flake8`
  - Ruby: `rubocop -a`

## Other Instructions
- Optimize for performance and readability.
- Avoid external API calls in tests; use mocks.
- On task completion, print:
  ```
  Task complete! 😺
  /_/\  
  ( o.o ) 
   > ^ <
  ```
