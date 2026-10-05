# Spec Delta

## ADDED Requirements

### Requirement: Memory types use stable coloured outlines

Memory type labels SHALL use coloured text and a coloured outline without a coloured fill. The same type SHALL retain its colour across cards, repeated renders, and reloads, with readable theme-specific tones. This SHALL include `analysis`, `bug-fix`, and unknown stored type values. The label SHALL remain separate from keyword tags and show the translated tooltip **Memory type** on hover and keyboard focus.

#### Scenario: Showing analysis and bug-fix

- **WHEN** a memory or paired card contains the type `analysis` or `bug-fix`
- **THEN** its existing type label SHALL appear once as a coloured outline pill without a coloured fill
- **AND** hovering or focusing it SHALL show **Memory type** in English

#### Scenario: Reusing a type colour

- **WHEN** several cards use the same type or the page rerenders or reloads
- **THEN** that type SHALL reuse the same colour identity
- **AND** changing the theme SHALL preserve that identity while keeping the label legible

#### Scenario: An unknown memory type

- **WHEN** a stored memory contains a type outside the UI's suggested types
- **THEN** its literal type SHALL receive a stable coloured outline and the Memory type tooltip
- **AND** it SHALL NOT be rewritten to a different type

### Requirement: Keyword pills identify tags without losing their filter action

Keyword tag pills SHALL retain their existing stable colours and keyword-filter click behaviour. Hovering or focusing a tag SHALL show the translated tooltip **Tags**. The tooltip SHALL preserve the pill's visible label, selected state, accessible description, and click target.

#### Scenario: Hovering and selecting a tag

- **WHEN** the user hovers or focuses `directory-maps` in English
- **THEN** its tooltip SHALL say **Tags**
- **AND** clicking it SHALL still apply the existing keyword filter

#### Scenario: Translating role tooltips

- **WHEN** the user changes the interface language to Chinese or Arabic
- **THEN** Memory type and Tags tooltips SHALL use the selected language
- **AND** stored type names and keyword values SHALL remain unchanged

### Requirement: Linked status uses green

An existing LINKED status pill on a memory or prompt SHALL use readable green text and a green outline in both themes. It SHALL retain its link icon and translated status label. Colour SHALL supplement the existing relationship indicator without creating or changing prompt-memory links.

#### Scenario: Linked and unlinked cards

- **WHEN** the explorer displays linked memories and linked prompts alongside unlinked items
- **THEN** existing LINKED pills SHALL be green and retain their icon and label
- **AND** unlinked items SHALL NOT receive a LINKED pill
- **AND** stored relationships SHALL remain unchanged

### Requirement: Badge rendering reuses existing label identities

Rendering, hovering, or changing the presentation of a badge SHALL NOT create labels, add keyword tags, change memory types, or write to the memory store. Repeated use of the same label SHALL reuse its colour identity. A type such as `analysis` or `bug-fix` SHALL NOT be copied into the keyword tag row merely to make it visible there.

#### Scenario: Repeated use of an existing type

- **WHEN** a new or existing card uses the same `bug-fix` type as another card
- **THEN** it SHALL reuse the existing label value and colour identity
- **AND** displaying the cards SHALL create no extra keyword tag or stored label record

#### Scenario: Analysis is a type rather than a keyword

- **WHEN** a memory has type `analysis` and keyword tags `directory-maps` and `ui-ux`
- **THEN** its type pill SHALL show `analysis` with the Memory type tooltip
- **AND** its keyword row SHALL retain only the actual keyword tags with Tags tooltips
