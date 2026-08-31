# Trello cards

T3 Code can read Trello cards into editable chat prompts. It does not change cards in Trello.

## Set up Trello

1. Open **Settings → Integrations → Trello**.
2. Enter your Trello API key and API token, then select **Save credentials**.
3. Use the plus button beside **Trello** to add a board.
4. Associate the board with one T3 project.
5. Choose **Only selected lists** to use a whitelist, or **All except selected lists** to use a
   blacklist, then select the lists.

Board and list names are fetched from Trello when the settings page or board dialog is opened. T3
Code stores the board, list, card, project, and thread IDs needed for these associations.

## Start a chat from a card

Use the Trello button beside the project filter in the thread sidebar to switch views. The active
project filter also filters Trello boards and cards. Select **Start chat** on a card to open a new
draft containing the card title, description, and comments. Trello attachments are added to the
composer as attachments. Nothing is sent until you edit the draft and select Send.

Cards already linked to a chat show **Ongoing**. Opening one loads its chat. If the description,
comments, or attachments changed after the latest prompt, T3 Code asks which updates to add to the
composer. The Trello button beside the composer attachment control opens the linked card in your
browser.
