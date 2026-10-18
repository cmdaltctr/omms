# web-memory-chat Specification

## Purpose

Defines how the web UI answers the user's questions from stored memories and the user profile, with citations the user can open and conversations that are saved in the OMMS store.

## Requirements

### Requirement: Chat has its own page and sidebar item

The sidebar SHALL show a Chat item that opens the chat page at `/chat`. The item SHALL follow the active, collapsed, and keyboard behaviour of the other sidebar items. Opening `/chat` directly SHALL show the chat page.

#### Scenario: Open chat from the sidebar

- **WHEN** the user selects Chat in the sidebar
- **THEN** the chat page SHALL open at `/chat`
- **AND** the Chat item SHALL show as the current page

#### Scenario: Collapsed sidebar

- **WHEN** the sidebar is collapsed
- **THEN** the Chat item SHALL show its icon with the translated label as its accessible name

### Requirement: Chat needs the external memory model

The chat SHALL use only the external memory model settings: `memoryProvider`, `memoryModel`, `memoryApiUrl`, and `memoryApiKey`. When the settings are incomplete, the chat page SHALL name the missing settings, link to the Settings page, and disable the question input. The page SHALL NOT show any key value.

#### Scenario: Key missing

- **WHEN** `memoryApiKey` is not set
- **THEN** the chat page SHALL say that the memory API key is missing and link to Settings
- **AND** the question input SHALL be disabled

#### Scenario: Settings complete

- **WHEN** all required external memory model settings are set
- **THEN** the question input SHALL be enabled

### Requirement: Questions have a scope

Each question SHALL be asked in one scope: one project, or all projects. The user SHALL choose the scope before asking. A conversation SHALL keep the scope of its last question as the default for the next one.

#### Scenario: One project

- **WHEN** the user asks a question with the scope set to one project
- **THEN** memory sources SHALL come only from that project

#### Scenario: All projects

- **WHEN** the user asks with the scope set to all projects
- **THEN** memory sources MAY come from any project
- **AND** each source SHALL show its project name

### Requirement: The model plans the search from real tags and categories

Before searching, the chat SHALL send the question, the recent turns of the conversation, the tags that exist in the scope, and the categories in the user profile to the memory model. The model SHALL return one to three search phrases, the tags to use, and the profile categories to use. The chat SHALL drop any returned tag or category that does not exist. When the planning call fails or returns nothing usable, the chat SHALL search with the question text alone and SHALL still answer.

#### Scenario: Unknown tag dropped

- **WHEN** the plan returns the tags `bun` and `made-up-tag`, and only `bun` exists in the scope
- **THEN** the search SHALL use `bun`
- **AND** SHALL NOT use `made-up-tag`

#### Scenario: Planning fails

- **WHEN** the planning call times out
- **THEN** the chat SHALL search with the question text
- **AND** the answer SHALL say that the search plan was skipped

#### Scenario: Follow-up question

- **WHEN** the user asks "and for Pi?" after a question about OpenCode capture
- **THEN** the planning call SHALL receive the recent turns so the search phrases can name Pi capture

### Requirement: Search covers memories and profile items

The chat SHALL search memories with each search phrase and with the chosen tags, and SHALL merge the results without duplicates. It SHALL add the profile preferences, patterns, and workflows in the chosen categories, and the profile items closest to the question. The number of memory sources and of profile sources per answer SHALL each have a fixed upper limit.

#### Scenario: Duplicate memory

- **WHEN** two search phrases return the same memory
- **THEN** that memory SHALL appear as one source

#### Scenario: Profile category chosen

- **WHEN** the plan chooses the profile category `tooling`
- **THEN** the sources SHALL include profile items in `tooling`, up to the limit

### Requirement: Answers come only from cited sources

The chat SHALL number the sources found, `S1`, `S2`, … for memories and `P1`, `P2`, … for profile items, and SHALL ask the model to answer only from them and to cite them. The chat SHALL remove any citation that names a source it did not send. When no source is found, the chat SHALL say that it found nothing relevant and SHALL NOT call the model for an answer. When the model says the sources do not answer the question, the chat SHALL say so.

#### Scenario: Invented citation

- **WHEN** the answer cites `S9` and only `S1` to `S4` were sent
- **THEN** the shown answer SHALL NOT contain a citation to `S9`

#### Scenario: Nothing found

- **WHEN** the search returns no memory and no profile source
- **THEN** the chat SHALL reply that it found nothing relevant in the scope
- **AND** no answer call SHALL be made

### Requirement: Citations open their source

Each citation in an answer SHALL be a control that opens its source. A memory source SHALL show its text, project, date, and tags, with a link to the memory in Project memories. A profile source SHALL show its section, category, description, and evidence. Each answer SHALL also list all its cited sources below the text.

#### Scenario: Open a memory citation

- **WHEN** the user activates the `S2` citation
- **THEN** a dialog SHALL show the S2 memory's text, project, date, and tags

#### Scenario: Source deleted later

- **WHEN** the user opens a saved answer whose cited memory was deleted after the answer
- **THEN** the dialog SHALL show the text saved with the answer
- **AND** SHALL say that the memory no longer exists

### Requirement: Each answer shows how it searched

Each answer SHALL show the search phrases, tags, and profile categories that were used, and whether the plan was skipped.

#### Scenario: Search details

- **WHEN** an answer was produced with the phrases `bun install error` and the tag `bun`
- **THEN** the answer SHALL show those phrases and that tag

### Requirement: Conversations are saved in the OMMS store

The chat SHALL save each conversation, its questions, answers, cited source snapshots, and search details in one file, `chats.db`, in the OMMS data folder. The user SHALL be able to start, open, rename, and delete a conversation. A new conversation SHALL take its title from the start of its first question.

#### Scenario: Reopen after restart

- **WHEN** the user asks a question, restarts the web app, and opens the chat page
- **THEN** the conversation SHALL be listed with its answer and citations

#### Scenario: Delete a conversation

- **WHEN** the user deletes a conversation and confirms
- **THEN** its questions, answers, and saved sources SHALL be removed from the store

### Requirement: Conversations can be grouped in folders

The user SHALL be able to create, rename, and delete chat folders. Folders SHALL be one level deep. A conversation SHALL be in one folder or in no folder. The user SHALL be able to start a new conversation inside a folder, and to move an existing conversation into a folder or out of all folders. The conversation list SHALL show each folder with its conversations and a count, and SHALL show conversations in no folder in their own group. Folder names SHALL be 1 to 80 characters after trimming, and two folders SHALL NOT have the same name, ignoring case.

#### Scenario: Start a chat in a folder

- **WHEN** the user selects "New chat" in the folder `Thesis`
- **THEN** the new conversation SHALL be listed in `Thesis`

#### Scenario: Move a chat

- **WHEN** the user moves a conversation from no folder into `Thesis`
- **THEN** the conversation SHALL be listed in `Thesis` and no longer in the no-folder group

#### Scenario: Duplicate folder name

- **WHEN** a folder `Thesis` exists and the user creates a folder `thesis`
- **THEN** the chat SHALL refuse the name and say that the folder exists

### Requirement: Deleting a folder deletes its chats

Deleting a folder SHALL delete the folder and every conversation in it, with their questions, answers, and saved sources. Before it deletes, the page SHALL ask for confirmation and SHALL state how many conversations will be deleted. Deleting an empty folder SHALL also ask for confirmation. The delete SHALL be all or nothing.

#### Scenario: Delete a folder with chats

- **WHEN** the user deletes the folder `Thesis`, which holds 4 conversations
- **THEN** the confirmation SHALL say that 4 conversations will be deleted
- **AND** after confirmation, the folder and the 4 conversations SHALL be removed from the store

#### Scenario: Cancel a folder delete

- **WHEN** the user cancels the confirmation
- **THEN** the folder and its conversations SHALL remain

### Requirement: Several chats can be deleted at once

The conversation list SHALL have a select mode in which the user can tick several conversations, in one folder or across folders, and delete them together. The page SHALL show how many are selected, SHALL offer to select all conversations in a folder, and SHALL ask for confirmation that states the count before it deletes. The delete SHALL be all or nothing. Leaving select mode SHALL clear the selection.

#### Scenario: Delete three chats

- **WHEN** the user ticks 3 conversations in two folders, selects Delete, and confirms
- **THEN** the 3 conversations SHALL be removed from the store
- **AND** both folders SHALL remain

#### Scenario: Open chat is deleted

- **WHEN** the selection includes the conversation that is open
- **THEN** after the delete, the page SHALL show an empty new chat

#### Scenario: Keyboard selection

- **WHEN** the user moves focus to a conversation in select mode and presses Space
- **THEN** that conversation SHALL be ticked or unticked

### Requirement: The chat file can be copied to another computer

`chats.db` SHALL hold every conversation's data by itself, with no other file needed once the web app has stopped. The chat SHALL NOT write absolute paths, user names, or email addresses into its own fields: titles, scope tags, project names, project tags, search plans, and timestamps. Cited source snapshots SHALL keep the memory or profile text exactly as it was when the answer was written, so that text can contain whatever the user's memories contain, such as folder paths. The docs SHALL warn that the file holds copies of memory text and must not be committed to Git or shared. It SHALL record its schema version. When a copied `chats.db` is placed in another computer's OMMS data folder while that web app is stopped, the chat page on that computer SHALL list the same conversations with their answers, citations, and search details.

#### Scenario: Copy to a second computer

- **WHEN** the user stops the web app, copies `chats.db` to another computer's OMMS data folder, and starts the web app there
- **THEN** the chat page SHALL list every copied conversation
- **AND** each citation SHALL open its saved source

#### Scenario: Project with the same git remote

- **WHEN** a copied conversation's scope is a project whose git remote also exists on the second computer
- **THEN** the next question in that conversation SHALL search that project

#### Scenario: Project missing on the second computer

- **WHEN** a copied conversation's scope matches no project on the second computer
- **THEN** the conversation SHALL show that the project is not on this computer
- **AND** saved answers SHALL still open their sources
- **AND** the next question SHALL ask the user to choose a scope

#### Scenario: File from a newer OMMS

- **WHEN** the copied `chats.db` has a newer schema version than this OMMS supports
- **THEN** the chat page SHALL show the conversations as read-only
- **AND** SHALL say that OMMS needs an upgrade to continue them

#### Scenario: File from an older OMMS

- **WHEN** the copied `chats.db` has an older schema version
- **THEN** OMMS SHALL update the file in place and keep every conversation

### Requirement: Chat protects private text and logs no content

The chat SHALL remove text inside `<private>` tags from a question before it is sent to the model or saved. It SHALL refuse a question that is fully private. Logs SHALL hold only sizes, counts, identifiers, timings, and error codes. They SHALL NOT hold questions, answers, prompts, or source text. Model errors shown to the user SHALL NOT contain the API key.

#### Scenario: Private text in a question

- **WHEN** the user asks "why did this fail <private>token abc123</private>"
- **THEN** neither the model request nor the saved question SHALL contain `abc123`

#### Scenario: Fully private question

- **WHEN** the question is only `<private>…</private>`
- **THEN** the chat SHALL refuse it without calling the model

### Requirement: Progress and failure are visible

While a question is being answered, the page SHALL show a progress state and SHALL keep the question visible. When the answer call fails, the page SHALL show a short error with a retry action, and the question SHALL stay in the conversation.

#### Scenario: Answer call fails

- **WHEN** the model API returns an error for the answer call
- **THEN** the page SHALL show the error and a retry action
- **AND** the question SHALL remain in the conversation

### Requirement: Chat is usable in every supported language and width

Every chat label, message, and control SHALL be available in every supported language. In Arabic, the page SHALL lay out right to left. At a 390 px width, the page SHALL show the conversation without horizontal scrolling, and the conversation list SHALL open as a panel.

#### Scenario: Narrow screen

- **WHEN** the page is 390 px wide
- **THEN** the conversation and the input SHALL fit without horizontal scrolling
