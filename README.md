# SAI cloud Claude

Claude Code for the SAI phone app while the owner's PC is off. It runs on Render's free plan, signed in with
the owner's own Claude plan (`CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token`). Only SAI Cloud can use it:
each request carries a one-time nonce that the server checks with SAI Cloud. Claude may only search and read
the web here (no shell, no files).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dtubugk-gif/sai-cloud-claude)
