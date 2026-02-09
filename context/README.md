# DevAI Context Folder

This folder contains reference documents that DevAI can read to provide better assistance.

## Usage

Drop `.txt` or `.md` files into the `documents/` subfolder. DevAI will automatically:
- List available documents when asked
- Read document contents when relevant to your question
- Search across documents for specific information

## Supported Formats

- `.txt` - Plain text files
- `.md` - Markdown files

## Security

- DevAI has **read-only** access to this folder
- Documents are never modified or deleted by DevAI
- Contents are only sent to the LLM when explicitly requested
