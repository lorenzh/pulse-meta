# Factory task

You are running state `{{state.name}}` in workflow `{{workflow.name}}`.

{{#if workspace.target}}
Work in `{{project.root}}`, a fresh clone of the repository `{{workspace.target}}`
({{workspace.targetUrl}}) on branch `{{workspace.branch}}`. Change files only there.
Other repositories are cloned read-only under
`{{project.root}}/{{workspace.contextDirectory}}/<target>`. Git never
commits them, so do not edit them.
{{else}}
Work in `{{project.root}}`.
{{/if}}
Read and follow the repository instructions before you edit files.
Do not change provider labels or comments. The Factory applies your final outcome.
Create and edit files with your file tools, not with shell redirection or heredocs.
If a tool call fails, fix it or say so in your outcome. Never report a file that you did not write.

Issue: {{issue.title}}

{{issue.body}}

{{#if issue.comments}}
## Issue comments

{{#each issue.comments}}
### {{author}}

{{body}}

{{/each}}
{{/if}}
