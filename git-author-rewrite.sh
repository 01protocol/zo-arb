#!/bin/sh

echo ""
echo "OLD_EMAIL     = $1"
echo "CORRECT_NAME  = $2"
echo "CORRECT_EMAIL = $3"
echo ""

git filter-branch --env-filter '
OLD_EMAIL="'"$1"'"
CORRECT_NAME="'"$2"'"
CORRECT_EMAIL="'"$3"'"
if [ "$GIT_COMMITTER_EMAIL" = "$OLD_EMAIL" ]
then
    export GIT_COMMITTER_NAME="$CORRECT_NAME"
    export GIT_COMMITTER_EMAIL="$CORRECT_EMAIL"
fi
if [ "$GIT_AUTHOR_EMAIL" = "$OLD_EMAIL" ]
then
    export GIT_AUTHOR_NAME="$CORRECT_NAME"
    export GIT_AUTHOR_EMAIL="$CORRECT_EMAIL"
fi
' --tag-name-filter cat -- --branches --tags
