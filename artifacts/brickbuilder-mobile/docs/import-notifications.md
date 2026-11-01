# Missing-parts notifications

For IO, LDR, MPD and internal JSON imports, recognizable part references with
missing or invalid geometry are shown in a directly visible in-app notification:

- In the file preview before creating a project.
- In the editor after successful creation and when reopening the project.
- With LDraw part number, affected count and failure reason.
- Also with the BrickLink part number if explicitly mapped.

Repeated parts are grouped by reference. The list scrolls on small screens.
The notification does not disappear automatically; it can be dismissed in the
editor. Reopening or reloading shows it again while the project still contains
missing geometry.

A missing BrickLink mapping or unknown color does not mean a part failed to
import. Those issues remain in the detailed import report and are not reported
as failed part geometry.

Underlying references and source data are neither deleted nor replaced with
other bricks. This feature does not automatically download missing geometry.
A completely unreadable file still produces a file error; part numbers cannot
be listed without readable references.

Automated DOM tests check visible IDs, grouping, reasons, dismissal, reappearance
and safe text rendering. The notification is marked as an alert for screen
readers. These notifications have not yet been tested on physical Android hardware.
