#!/usr/bin/env bash
set -euo pipefail

# setup-agent-auth.sh
#
# Sets up authentication for the autonomous agent workflows.
# Run this OUTSIDE of Claude Code (in a regular terminal).
#
# For Max subscription OAuth:
#   1. Exports your Claude Code OAuth token from the system keychain
#   2. Adds it as a GitHub Actions secret
#
# For API key auth:
#   1. Takes your API key as input
#   2. Adds it as a GitHub Actions secret

REPO="nateschmiedehaus/LiBrainian"

echo "═══════════════════════════════════════════════"
echo "  LiBrainian Agent Auth Setup"
echo "═══════════════════════════════════════════════"
echo ""
echo "Choose your auth method:"
echo "  1) Claude Code OAuth (Max subscription)"
echo "  2) Anthropic API key (from console.anthropic.com)"
echo ""
read -p "Choice [1/2]: " CHOICE

case "$CHOICE" in
  1)
    echo ""
    echo "To export your OAuth token, run this in a terminal (NOT inside Claude Code):"
    echo ""
    echo "  # macOS — extract from keychain:"
    echo '  TOKEN=$(security find-generic-password -s "claude.ai" -w 2>/dev/null || \\'
    echo '          security find-generic-password -s "claude-code" -w 2>/dev/null)'
    echo ""
    echo "  # Or check the Claude Code config:"
    echo '  TOKEN=$(cat ~/.claude-code/auth.json 2>/dev/null | jq -r ".oauthToken // empty")'
    echo ""
    echo "  # Then set it as a secret:"
    echo "  gh secret set CLAUDE_CODE_OAUTH_TOKEN -R $REPO --body \"\$TOKEN\""
    echo ""
    echo "If neither works, the simplest path is an API key (option 2)."
    echo ""

    read -p "Do you have the token? Paste it (or press Enter to skip): " TOKEN
    if [ -n "$TOKEN" ]; then
      echo "$TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$REPO"
      echo "✅ CLAUDE_CODE_OAUTH_TOKEN secret set!"
    else
      echo "Skipped. Set it manually with:"
      echo "  gh secret set CLAUDE_CODE_OAUTH_TOKEN -R $REPO"
    fi
    ;;

  2)
    echo ""
    echo "Get your API key from https://console.anthropic.com/settings/keys"
    echo ""
    read -sp "Paste your API key: " API_KEY
    echo ""
    if [ -n "$API_KEY" ]; then
      echo "$API_KEY" | gh secret set ANTHROPIC_API_KEY -R "$REPO"
      echo "✅ ANTHROPIC_API_KEY secret set!"
    else
      echo "No key provided. Set it manually with:"
      echo "  gh secret set ANTHROPIC_API_KEY -R $REPO"
    fi
    ;;

  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

echo ""
echo "Verifying secrets..."
gh secret list -R "$REPO" --json name --jq '.[].name' | grep -E "CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY" && \
  echo "✅ Auth secret found!" || \
  echo "⚠️  No auth secret detected. Workflows will fail without one."

echo ""
echo "Next steps:"
echo "  1. Push the new workflow files to main"
echo "  2. Run: node scripts/curate-agent-backlog.mjs"
echo "  3. Test manually: gh workflow run 'Agent Work Loop' -R $REPO -f issue_number=883"
echo "  4. Watch: gh run watch -R $REPO"
echo ""
