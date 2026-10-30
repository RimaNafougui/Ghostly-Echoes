# Requirements Document

## Introduction

Ghostly Echoes is a stage-based browser game starring Ghosty, a friendly ghost. Each Stage is a fixed, seeded Course that scrolls horizontally while the Player controls Ghosty with a single flap input. When a Run ends in death, the Run's flap inputs are recorded per Tick and become an Echo: a translucent, tinted ghost that replays the exact same path on subsequent Attempts of the same Stage. The Player cooperates with past selves, most notably by having an Echo hold a Rune so that its matching Rune_Gate opens for the live Player. Runes respond only to Echoes: the live Player overlapping a Rune never opens a Rune_Gate.

The game is built with plain HTML5 canvas and vanilla JavaScript, has no dependencies and no build step, and runs by opening `index.html` locally or on GitHub Pages. The Simulation is deterministic (fixed timestep, seeded RNG, no `Math.random` or wall-clock time) and is separated from rendering so that Runs can be replayed headlessly in unit tests.

### Stated Assumptions

The following defaults resolve ambiguities in the original request. Each is reflected in the requirements below and can be changed during review.

- A1 (Rune mechanic): On one Run the Player flies through a Rune's area and then ends that Run (by manual restart after passing the Rune, or by death); that Run becomes an Echo. On a later Attempt the Echo overlaps the Rune and holds the linked Rune_Gate open while the live Player flies through. The Player overlapping a Rune never opens its Rune_Gate.
- A2 (Stage clear): Clearing a Stage does not create an Echo. All Echoes are discarded when a new Stage loads.
- A3 (Echo end): An Echo is visible from Tick 0 until the Tick at which its recorded Run ended, then the Echo is removed. An Echo does not continue simulating past its recorded inputs.
- A4 (Gate hold time): A Rune_Gate stays open for 30 Ticks (0.5 seconds at 60 Ticks per second) after the last Echo leaves the Rune.
- A5 (Ghost interaction): Ghosts do not collide with or block each other. Echoes pass through walls, Hazards, and Rune_Gates.
- A6 (Attempt counter): The Attempt number is per Stage and resets to 1 when a new Stage loads.
- A7 (Difficulty): Stages are generated endlessly. Stage N uses a seed derived from a base seed and N, and difficulty parameters (gap size, obstacle spacing, Hazard frequency, and Rune_Gate count from 1 at Stage 1 up to 3) scale with N up to fixed limits.
- A8 (Scrolling): The Course scrolls at a fixed horizontal speed per Stage, so Ghosty's horizontal position is a pure function of the Tick.
- A9 (Manual restart): A manual restart ends the current Run, and the aborted Run becomes an Echo (Requirement 8.3), so that the Player can deliberately record a Run that holds a Rune without needing to die.
- A10 (Closed gate): Contact between the Player and a closed Rune_Gate kills the Player.
- A11 (Rune detection through walls): Echoes trigger Runes regardless of overlapping terrain; the Player never triggers Runes.
- A12 (Input): Keyboard (Space or ArrowUp), mouse click, and touch all produce a flap. Input events are queued and applied at the start of the next Tick; multiple flaps in one Tick count as one flap.
- A13 (Persistence): No game state persists across page reloads.
- A14 (Floating-point): Determinism is required within a single browser session. Simulation state uses integer (fixed-point) arithmetic so results are identical across browsers.
- A15 (Construction-based generation): The Stage_Generator builds each Course around a Solution_Witness instead of searching for one. The Stage_Generator first chooses the witness Input_Logs (one Player Input_Log and 1 to 3 Echo Input_Logs), simulates them headlessly to get their position sequences, and then places walls, Hazards, Runes, Rune_Gates and passages around the Player witness path. There is no candidate-retry loop and no fallback Course.
- A16 (Countdowns): After a Stage is cleared, the Game runs a 60-step post-clear Countdown outside the Simulation before loading the next Stage, in the same way as the 60-step post-death Countdown that runs before the next Attempt.
- A17 (Script loading): Game scripts load as classic (non-module) scripts so that the Game works over `file://`. The same Simulation scripts must also load in Node without the DOM for headless tests (for example through a guarded `module.exports` or `globalThis` assignment); the mechanism is left to design.
- A18 (Rune-to-gate distance): Because all Ghosts share the same horizontal position at each Tick, an Echo leaves a Rune at the same Tick the Player's horizontal position passes that Rune. The horizontal distance from a Rune's right edge to its linked Rune_Gate's right edge (which covers both the gap and the Rune_Gate's width) is therefore limited to 30 × the Stage's scroll speed, so that the 30-Tick hold period keeps the Rune_Gate open until the Player has fully passed the Rune_Gate. This only works if the Echo remains present until its hitbox leaves the Rune, which is why the Player should press R only after passing the Rune.
- A19 (Test scale): Each property test runs about 500 seeded cases, with generated Input_Logs of up to 3,600 Ticks (60 seconds of play). Stage-level properties are checked over Stages 1 to 50.

## Glossary

- **Game**: The complete Ghostly Echoes browser application.
- **Simulation**: The deterministic, rendering-independent module that advances game state by one Tick given the state and a flap input.
- **Renderer**: The module that draws the current Simulation state to the HTML5 canvas.
- **Input_Handler**: The module that captures keyboard, mouse, and touch events and converts them into per-Tick flap inputs.
- **Recorder**: The module that stores the flap input of each Tick of a Run.
- **Echo_Manager**: The module that stores Echoes for the current Stage and enforces the Echo limit.
- **Stage_Generator**: The module that builds a Course and its Solution_Witness from a Stage number and seed.
- **HUD**: The heads-up display overlay drawn on top of the canvas.
- **Test_Suite**: The automated, dependency-free headless test suite, run with Node's built-in test runner (`node --test`).
- **Tick**: One fixed Simulation step of 1/60 second.
- **Countdown**: A 60-step (1 second) delay maintained by the Game outside the Simulation, used after the Player's death (post-death Countdown) and after a Stage clear (post-clear Countdown). While a Countdown runs, the Simulation is not stepped, the Tick counter does not advance, and nothing is appended to any Input_Log.
- **Seeded_RNG**: A pseudo-random number generator whose output sequence is fully determined by its seed.
- **Stage**: A numbered level, starting at 1, with its own seed and difficulty parameters.
- **Course**: The fixed layout of walls, Hazards, Runes, Rune_Gates, and Finish_Line for a Stage.
- **Hazard**: A Course element that kills the Player on contact.
- **Rune_Gate**: A barrier that seals a passage in the Course and is linked to exactly one Rune. A Rune_Gate opens only while an Echo holds the linked Rune and during the hold period after.
- **Rune**: A trigger zone placed at the opposite vertical half of the Course from its linked Rune_Gate's passage. A Rune is activated only by Echo overlap; Player overlap has no effect.
- **Finish_Line**: The horizontal position at the end of a Course that clears the Stage when reached.
- **Player**: The live, input-controlled Ghosty.
- **Echo**: A translucent, tinted ghost that replays a recorded Input_Log from Tick 0.
- **Ghost**: Either the Player or an Echo.
- **Run**: One play of a Stage from Tick 0 until death, manual restart, or Stage clear.
- **Attempt**: A numbered Run within the current Stage, starting at 1.
- **Input_Log**: The ordered sequence of per-Tick flap values (flap or no flap) recorded during a Run.
- **Solution_Witness**: One Player Input_Log and between 1 and 3 Echo Input_Logs produced by the Stage_Generator that clear the Stage when replayed headlessly.
- **Flap**: A single input that sets Ghosty's vertical velocity to a fixed upward value.

## Requirements

### Requirement 1: Deterministic Simulation

**User Story:** As a player, I want each Stage to behave identically every time, so that my past Runs replay exactly and I can plan around them.

#### Acceptance Criteria

1. WHEN the Simulation is stepped once, THE Simulation SHALL advance game state by exactly one Tick, representing 1/60 second of game time, and increment the Tick counter by exactly 1.
2. THE Simulation SHALL derive all randomness from the Seeded_RNG, initialized with an integer seed in the range 0 to 4,294,967,295, and SHALL NOT read any other source of randomness or the wall-clock time.
3. WHEN the Simulation computes the next state, THE Simulation SHALL use only the current state and the flap input for that Tick, where the flap input is a boolean value (flap or no flap).
4. THE Simulation SHALL represent positions and velocities as integer fixed-point values that remain integers within the range -2,147,483,648 to 2,147,483,647 after every Tick.
5. FOR ALL seeds in the range 0 to 4,294,967,295 and all Input_Logs of up to 3,600 Ticks (exercised by about 500 seeded test cases, Requirement 12), running the Simulation twice from the same initial state SHALL produce state sequences in which every state field is equal at every Tick index (determinism property).
6. THE Simulation SHALL run without access to the Renderer, the canvas, or the browser DOM, such that it executes to completion in an environment where none of these are defined.
7. WHEN a rendered frame begins, THE Game SHALL add the elapsed time since the previous frame to an accumulator, execute one Tick for each full 1/60 second in the accumulator up to a maximum of 5 Ticks, and carry any remainder of less than one Tick over to the next frame.
8. IF the accumulated elapsed time at the start of a rendered frame exceeds 5 Ticks, THEN THE Game SHALL execute exactly 5 Ticks and discard the remaining accumulated time without executing extra Ticks in later frames.
9. WHEN the Simulation replays an Input_Log, THE Simulation SHALL apply the recorded flap input for each Tick index, and IF the Input_Log has no entry for a Tick index, THEN THE Simulation SHALL treat that Tick's flap input as no flap.
10. FOR ALL rendered frame rates between 30 and 240 frames per second and all Input_Logs of up to 3,600 Ticks (about 500 seeded cases, Requirement 12), THE Simulation SHALL produce the same state sequence for a given seed and Input_Log as it produces when stepped directly Tick by Tick.

### Requirement 2: Flap Input

**User Story:** As a player, I want to control Ghosty with one simple input on any device, so that the game is easy to pick up.

#### Acceptance Criteria

1. WHEN the Player triggers a non-repeated keydown of Space or ArrowUp anywhere on the page, a primary-button (left) mouse press on the canvas, or a touch start on the canvas, THE Input_Handler SHALL queue exactly one Flap for the next Tick, and SHALL ignore keydown events flagged as auto-repeat and mouse presses from non-primary buttons.
2. WHEN one or more Flaps are queued at the start of a Tick, THE Input_Handler SHALL deliver exactly one Flap to the Simulation for that Tick and clear the queue, so that N queued Flaps (N ≥ 1) within a single Tick produce the same Simulation state as 1 queued Flap.
3. WHEN the Simulation receives a Flap for a Tick while the Player is alive, THE Simulation SHALL replace the Player's vertical velocity with the fixed upward Flap velocity (an integer fixed-point constant directed toward decreasing y), discarding the previous vertical velocity regardless of its sign or magnitude.
4. WHILE the Player is alive, THE Simulation SHALL, in each Tick, first apply the delivered Flap (if any), then add the fixed integer fixed-point gravity constant to the Player's vertical velocity, then add the resulting vertical velocity to the Player's vertical position, in exactly that order.
5. THE Simulation SHALL, in each Tick, increase every Ghost's horizontal position in Course coordinates (toward increasing x, with the camera following the Player) by exactly the Stage's fixed integer fixed-point scroll speed, independent of the rendering frame rate.
6. IF a Flap input occurs while the Player is not alive, THEN THE Input_Handler SHALL discard it without queuing a Flap, and the Player's vertical velocity and position SHALL remain unchanged by that input.
7. WHEN the Input_Handler handles a Space or ArrowUp keydown, or a touch start on the canvas, THE Input_Handler SHALL suppress the browser's default action, so that the page does not scroll and a single touch does not also produce a synthesized mouse Flap.
8. WHEN the Simulation is run twice from the same initial state with the same per-Tick sequence of delivered Flaps, THE Simulation SHALL produce identical Player vertical positions, Player vertical velocities, and Ghost horizontal positions at every Tick.

### Requirement 3: Run Recording

**User Story:** As a player, I want my Runs recorded as inputs, so that they can become Echoes that follow my exact path.

#### Acceptance Criteria

1. WHEN a Run starts, THE Recorder SHALL create a new Input_Log with zero entries for that Run, separate from the Input_Log of any previous Run.
2. WHEN a Tick of the Run is simulated, THE Recorder SHALL append exactly one flap value to the end of the Input_Log for that Tick. The value is true if one or more flap inputs were registered during that Tick, and false if none were registered.
3. WHEN the Player dies, THE Recorder SHALL finalize the Input_Log so that its length equals the number of Ticks simulated in the Run, including the Tick in which the Player died. Entry index i (starting from 0) corresponds to the i-th simulated Tick.
4. WHEN the Player triggers a manual restart by pressing R during a Run, THE Recorder SHALL finalize the Input_Log so that its length equals the number of Ticks simulated in the Run before the restart. Entry index i (starting from 0) corresponds to the i-th simulated Tick.
5. THE Recorder SHALL store only one flap value per simulated Tick in the Input_Log. It SHALL NOT store Ghost positions, Player positions, Player velocities, or timestamps.
6. WHILE no Tick of the Run is being simulated (before the Run starts or after the Input_Log is finalized), THE Recorder SHALL NOT append entries to the Input_Log, even if flap inputs are registered.
7. WHEN an Input_Log has been finalized, THE Recorder SHALL keep its length and entry values unchanged for as long as it is used as an Echo.
8. IF a Run ends by Player death or manual restart with zero Ticks simulated, THEN THE Recorder SHALL discard that Input_Log and SHALL NOT make it available as an Echo.

### Requirement 4: Exact Echo Replay

**User Story:** As a player, I want Echoes to retrace my past Runs exactly, so that I can rely on them to hold Runes.

#### Acceptance Criteria

1. WHEN a Run starts, THE Simulation SHALL place every stored Echo at Tick 0 with the same initial position and the same initial velocity as the Player at Tick 0.
2. WHEN a Tick is simulated, THE Simulation SHALL apply the Echo's recorded flap value (flap or no flap) for that Tick index to the Echo, using the same physics update and the same update order within the Tick that the Player received when the Input_Log was recorded.
3. THE Simulation SHALL produce, for every seed, every Input_Log of up to 3,600 Ticks (about 500 seeded cases, Requirement 12) and every Tick index from 0 to the last Tick of the Input_Log, an Echo position and velocity exactly equal (zero tolerance) to the Player's position and velocity at the same Tick index in the recorded Run (replay round-trip property).
4. WHEN the Simulation completes the Tick whose index equals the last recorded Tick of an Echo's Input_Log, THE Simulation SHALL remove the Echo from the current Run before the next Tick is simulated, so that the Echo is not drawn and cannot interact with Runes or Rune_Gates on any later Tick of that Run.
5. WHILE an Echo overlaps a wall, a Hazard, or a Rune_Gate, THE Simulation SHALL leave the Echo's position and velocity unchanged by that overlap and SHALL continue the Echo's replay without ending it.
6. WHILE two or more Ghosts (Player or Echoes) overlap each other, THE Simulation SHALL apply no collision response, leaving each Ghost's position and velocity unchanged by the overlap and ending no Ghost's replay or Run.
7. THE Renderer SHALL draw each Echo as a tinted Ghosty sprite with an opacity of at least 30% and at most 60%.
8. THE Renderer SHALL draw each Echo with a tint that differs from the tint of every other Echo drawn in the same frame, and SHALL keep each Echo's tint the same for every frame of the current Run.
9. WHEN a Run ends by Player death or manual restart, THE Recorder SHALL store an Input_Log whose last Tick is the final Tick simulated for the Player in that Run.
10. IF a stored Input_Log contains zero recorded Ticks, THEN THE Simulation SHALL create no Echo for that Input_Log when a Run starts.

### Requirement 5: Echo Limit

**User Story:** As a player, I want a small, fixed number of Echoes, so that the screen stays readable and I must choose Runs carefully.

#### Acceptance Criteria

1. WHEN a Run ends by death or manual restart, THE Echo_Manager SHALL store exactly one new Echo for the current Stage, containing that Run's complete Input_Log.
2. THE Echo_Manager SHALL hold between 0 and 3 Echoes (inclusive) for the current Stage at all times.
3. IF a new Echo is stored while the Echo_Manager already holds 3 Echoes, THEN THE Echo_Manager SHALL discard exactly one Echo, the oldest stored Echo, before storing the new Echo, leaving 3 Echoes with the relative order of the 2 retained Echoes unchanged.
4. THE Echo_Manager SHALL keep the stored Echoes for the current Stage ordered from oldest to newest, where order is determined by the sequence in which their Runs ended.
5. FOR ALL sequences of stored Runs on the current Stage, with each stored Run's Input_Log of up to 3,600 Ticks (about 500 seeded cases, Requirement 12), THE Echo_Manager SHALL hold exactly the Input_Logs of the most recent min(n, 3) stored Runs, in the order those Runs ended, where n is the number of stored Runs on the current Stage (echo limit invariant).
6. WHEN a Run clears the current Stage, THE Echo_Manager SHALL discard that Run without storing it as an Echo, and SHALL NOT evict or reorder any Echo already stored as a result of that Run.
7. WHEN a Stage is entered, THE Echo_Manager SHALL hold 0 Echoes until the first Run on that Stage is stored.
8. THE Echo_Manager SHALL keep each stored Echo's Input_Log identical to the Input_Log recorded during its Run, with no inputs added, removed, or reordered, for as long as that Echo is stored.

### Requirement 6: Rune Gates

**User Story:** As a player, I want Echoes to hold Runes that open Rune_Gates, so that I can cooperate with my past selves to get through sealed passages.

#### Acceptance Criteria

1. THE Stage_Generator SHALL link each Rune_Gate to exactly one Rune and each Rune to exactly one Rune_Gate. The Rune's center SHALL be in the vertical half of the Course opposite the half containing the Rune_Gate's passage center, the Rune's right edge SHALL have a horizontal position less than the Rune_Gate's left edge, and (Rune_Gate right edge − Rune right edge) SHALL be less than or equal to 30 × the Stage's scroll speed.
2. WHILE at least one Echo's hitbox intersects a Rune's area at a Tick, THE Simulation SHALL set the linked Rune_Gate's state to open for that Tick.
3. WHEN a Tick T is the last Tick on which any Echo's hitbox intersects a Rune, THE Simulation SHALL keep the linked Rune_Gate open on each of Ticks T+1 through T+30 (the 30-Tick hold period) and SHALL set the Rune_Gate's state to closed on Tick T+31, unless criterion 4 applies.
4. WHEN any Echo's hitbox intersects a Rune on a Tick within the 30-Tick hold period, THE Simulation SHALL cancel the pending close, keep the linked Rune_Gate open, and restart the hold period from the last Tick of that new overlap as defined in criterion 3.
5. THE Simulation SHALL detect intersection between an Echo's hitbox and a Rune's area on every Tick, including Ticks on which terrain also overlaps that Echo.
6. IF the Player's hitbox intersects a Rune_Gate's area on a Tick on which that Rune_Gate's state is closed, THEN THE Simulation SHALL end the Run with the Player's death on that same Tick.
7. WHILE a Rune_Gate's state is open, THE Simulation SHALL let the Player's hitbox intersect the Rune_Gate's area without ending the Run and without changing the Player's position or velocity.
8. FOR ALL Ghost position sequences of up to 3,600 Ticks (about 500 seeded cases, Requirement 12), a Rune_Gate's state at Tick N SHALL be open if and only if at least one Echo's hitbox intersected the linked Rune's area on at least one Tick in the range max(0, N−30) through N inclusive (31 Ticks including Tick N, which is the overlap Tick plus the 30-Tick hold period from criterion 3), independent of the Player's position sequence. Ticks before the Run starts SHALL count as having no overlap, so every Rune_Gate's state SHALL be closed at Tick 0 unless an Echo intersects the linked Rune on Tick 0 (gate timing property).
9. THE Renderer SHALL draw each Rune and its linked Rune_Gate with the same symbol and the same color. That symbol-and-color pair SHALL be unique among the Rune/Rune_Gate pairs visible on screen at the same time.
10. THE Simulation SHALL let every Echo pass through any Rune_Gate whether its state is open or closed, without changing the Echo's recorded position sequence.
11. WHEN the Simulation processes a Tick, THE Simulation SHALL first update all Ghost positions, then work out each Rune_Gate's state for that Tick from the Echo–Rune intersections at those updated positions, and then evaluate Player contact with Rune_Gates (criteria 6 and 7) against that newly computed state.
12. WHEN a Rune_Gate's state changes between open and closed, THE Renderer SHALL draw the Rune_Gate in the new state on the frame for the Tick on which the state changed, with the open and closed states visually distinct.
13. WHILE the Player's hitbox intersects a Rune's area and no Echo's hitbox intersects that Rune's area, THE Simulation SHALL NOT open the linked Rune_Gate, so that Player overlap has no effect on Rune_Gate state.

### Requirement 7: Death by Walls and Hazards

**User Story:** As a player, I want clear failure conditions, so that I know what to avoid.

#### Acceptance Criteria

1. IF, at the end of any Tick, the Player's collision bounds overlap or share an edge with a wall's collision bounds, THEN THE Simulation SHALL end the Run with the Player's death on that same Tick.
2. IF, at the end of any Tick, the Player's collision bounds overlap or share an edge with a Hazard's collision bounds, THEN THE Simulation SHALL end the Run with the Player's death on that same Tick.
3. IF, at the end of any Tick, any part of the Player's collision bounds is above the top edge or below the bottom edge of the Course, THEN THE Simulation SHALL end the Run with the Player's death on that same Tick.
4. WHEN the Player dies, THE Game SHALL start playback of `assets/game_over.wav` exactly once for that death, even if more than one death condition from criteria 1, 2, 3 and 6 is met on the same Tick.
5. WHILE the Run is in progress, WHEN the Player Flaps, THE Game SHALL start playback of `assets/jump.wav` once for that Flap.
6. IF, at the end of any Tick, the Player's collision bounds overlap or share an edge with the collision bounds of a Rune_Gate that is closed on that Tick, THEN THE Simulation SHALL end the Run with the Player's death on that same Tick.
7. THE Simulation SHALL let Echoes pass through walls, Hazards, closed Rune_Gates and the top and bottom edges of the Course without ending the Run or changing the Echoes' recorded movement.
8. WHEN the Run ends with the Player's death, THE Simulation SHALL stop advancing the Player, ignore any later Flap input for that Run without playing `assets/jump.wav`, and keep the Player at its position from the Tick of death.
9. IF `assets/game_over.wav` or `assets/jump.wav` fails to load or play, THEN THE Game SHALL keep the death and Flap outcomes from criteria 1 to 8 unchanged and keep running without showing an error that stops the Game.

### Requirement 8: Restart and New Attempts

**User Story:** As a player, I want to retry quickly or abandon a Run on purpose, so that I can record the Echo I need.

#### Acceptance Criteria

1. WHEN the Player dies, THE Game SHALL end the current Run, record it as an Echo, run a post-death Countdown of 60 fixed steps maintained outside the Simulation, and start the next Attempt of the same Stage when the Countdown completes.
2. WHILE the post-death Countdown is in progress, THE Game SHALL ignore Flap and R inputs, so that no Run starts, no extra Echo is recorded, and the Attempt number stays the same.
3. WHEN the Player presses R while a Run is in progress, THE Game SHALL end the Run on the current Tick as a manual restart, record it as an Echo, and start the next Attempt of the same Stage with no delay (0 Ticks).
4. WHILE the R key is held down, THE Game SHALL treat the hold as a single press: it SHALL trigger at most one manual restart per press and SHALL ignore auto-repeat key events.
5. IF the Player presses R while no Run is in progress (the Game is waiting for the first Flap of an Attempt), THEN THE Game SHALL ignore the input, record no Echo, and leave the Attempt number unchanged.
6. WHEN a new Attempt starts, THE Game SHALL increment the Attempt number by exactly 1, where the first Attempt of a Stage has Attempt number 1.
7. WHEN a new Attempt starts, THE Simulation SHALL reset the Course, all Rune_Gates, the Player, and the Tick counter (to 0) to the Stage's initial state, and SHALL keep every Echo recorded in earlier Attempts of the same Stage.
8. WHEN a new Attempt starts, THE Game SHALL not simulate any Ticks until the Player's first Flap input. Inputs other than a Flap SHALL NOT start the Run.
9. WHEN the Player's first Flap of an Attempt is received, THE Simulation SHALL start the Run by simulating Tick 0 with that Flap applied on Tick 0.
10. WHILE a post-death or post-clear Countdown is in progress, THE Game SHALL NOT step the Simulation, SHALL NOT advance the Tick counter, and SHALL NOT append any entry to any Input_Log.

### Requirement 9: Stage Completion and Progression

**User Story:** As a player, I want to advance to harder Stages after clearing a Course, so that the game keeps challenging me.

#### Acceptance Criteria

1. WHEN the Player is alive at the end of a Tick and the Player's horizontal position is greater than or equal to the Finish_Line's horizontal position, THE Game SHALL mark the current Stage as cleared and end the Run, with death checks for that Tick evaluated before the Finish_Line check.
2. WHEN a Stage is cleared, THE Game SHALL run a post-clear Countdown of 60 fixed steps maintained outside the Simulation and load Stage N+1, where N is the cleared Stage number, when the Countdown completes, with no upper limit on N.
3. WHEN a new Stage loads, THE Echo_Manager SHALL discard all stored Echoes before Tick 0 of Attempt 1 of the new Stage, so that the stored Echo count is 0.
4. WHEN a new Stage loads, THE Game SHALL reset the Attempt number to 1 and wait for the Player's first Flap before simulating Tick 0.
5. THE Stage_Generator SHALL compute each Stage's seed as a pure function of a constant base seed defined in the Game and the Stage number, producing pairwise distinct seeds for Stage numbers 1 through 50.
6. FOR ALL Stage numbers from 1 to 50, generating the Course twice for the same Stage number, within one session or across page reloads, SHALL produce Courses with identical walls, Hazards, Runes, Rune_Gates, Finish_Line position, and scroll speed (generation determinism property).
7. WHEN the Stage number increases from N to N+1, THE Stage_Generator SHALL use a passage gap size less than or equal to Stage N's, an obstacle spacing less than or equal to Stage N's, a Hazard frequency greater than or equal to Stage N's, and a Rune_Gate count greater than or equal to Stage N's, where Stage 1 has exactly 1 Rune_Gate, the Rune_Gate count is at most 3, and every parameter equals its fixed limit value for all Stage numbers of 20 or higher.
8. WHEN the Stage_Generator generates a Course, THE Stage_Generator SHALL first choose the Solution_Witness Input_Logs (one Player Input_Log and between 1 and 3 Echo Input_Logs, each no longer than the number of Ticks needed to scroll from the start to the Finish_Line) and simulate each Input_Log headlessly to obtain its position sequence, before placing any wall, Hazard, Rune, Rune_Gate or passage.
9. WHEN the Stage_Generator places walls, Hazards, Runes, Rune_Gates and passages around the Solution_Witness position sequences, THE Stage_Generator SHALL place them so that (a) the Player witness path touches no wall, Hazard, or top or bottom Course edge on any Tick, (b) each Rune_Gate's passage contains the Player witness path on every Tick on which the Player witness hitbox intersects that Rune_Gate's area, and (c) each Rune is intersected by at least one Echo witness path such that the linked Rune_Gate is open (criterion 6.8) on every Tick on which the Player witness hitbox intersects that Rune_Gate's area. Each Echo witness Input_Log SHALL keep the Player alive, if played as the Player, through its last Tick, so that the Echo witness can be recorded in real play by a manual restart.
10. FOR ALL Stage numbers from 1 to 50, replaying the Solution_Witness headlessly (Echo Input_Logs as Echoes, Player Input_Log as the Player) SHALL clear the Stage with no Player death (solvability property).
11. THE Stage_Generator SHALL place at most 3 Rune_Gates per Course and SHALL use a minimum passage gap size limit of at least 2 times the Player's collision height.
12. FOR ALL Stage numbers from 1 to 50, every Rune/Rune_Gate pair in the generated Course SHALL satisfy criterion 6.1, including (Rune_Gate right edge − Rune right edge) ≤ 30 × the Stage's scroll speed (rune placement property).

### Requirement 10: HUD

**User Story:** As a player, I want to see my Attempt number and Echo count, so that I understand my progress on the current Stage.

#### Acceptance Criteria

1. WHILE a Stage is loaded, including the wait for the first Flap, an active Run, and the post-death and post-clear Countdowns, THE HUD SHALL display the current Attempt number as "Attempt: N", where N is an integer of 1 or greater that equals the Game's current Attempt number.
2. WHILE a Stage is loaded, including the wait for the first Flap, an active Run, and the post-death and post-clear Countdowns, THE HUD SHALL display the number of stored Echoes as "Echoes: X/3", where X is an integer from 0 to 3 that equals the number of Echoes the Echo_Manager holds for the current Stage.
3. WHILE a Stage is loaded, including the wait for the first Flap, an active Run, and the post-death and post-clear Countdowns, THE HUD SHALL display the current Stage number as "Stage: S", where S is an integer of 1 or greater that equals the Game's current Stage number.
4. WHEN the Attempt number, Echo count, or Stage number changes, THE HUD SHALL display the updated value in the first frame rendered after the change and SHALL NOT display the previous value in that frame.
5. THE Renderer SHALL draw the HUD after all Course elements and Ghosts in each rendered frame, with all HUD text fully inside the canvas bounds.
6. THE HUD SHALL read Game state without changing any Simulation state, so that a Run's state sequence is the same whether or not the HUD is drawn.
7. WHILE Stage 1 is loaded, THE HUD SHALL display the hint "Fly through the rune, press R once you're past it, then let your echo open the gate." fully inside the canvas bounds, so that the Player records an Echo that remains present until its hitbox leaves the Rune and can therefore hold the Rune_Gate open.
8. WHILE a Stage numbered 2 or higher is loaded, THE HUD SHALL omit the Stage 1 hint from criterion 7.

### Requirement 11: Platform and Packaging

**User Story:** As a player, I want to open the game directly in a browser, so that I can play without installing anything.

#### Acceptance Criteria

1. WHEN `index.html` is opened from the local file system (a `file://` URL) or from GitHub Pages, THE Game SHALL render Stage 1 on the canvas and accept Player input within 3 seconds of page load, with zero uncaught JavaScript errors reported in the browser console.
2. THE Game SHALL use only HTML5 canvas and vanilla JavaScript, loaded through classic (non-module) `<script>` elements that reference files by relative paths from `index.html`, with no third-party libraries, no package installation step, and no build, bundling, or transpilation step.
3. WHEN `assets/ghosty.png` has finished loading, THE Renderer SHALL draw the Player on every rendered frame using that image, scaled to the Player's width and height, without reading pixel data back from the canvas.
4. WHEN the page is loaded or reloaded, THE Game SHALL start at Stage 1, Attempt 1, with zero Echoes, regardless of any progress made before the reload, and THE Game SHALL NOT read or write game state to any browser storage (localStorage, sessionStorage, IndexedDB, or cookies).
5. IF `assets/ghosty.png` has not finished loading or fails to load, THEN THE Renderer SHALL draw the Player as a filled rectangle matching the Player's width and height, and THE Game SHALL remain playable with no uncaught JavaScript errors.
6. THE Game SHALL load all code and data from files inside the repository using relative paths, SHALL generate Stage data in JavaScript rather than fetching data files at runtime, and SHALL make no network requests to other origins.
7. THE Game SHALL keep its simulation logic (Player movement, Stage, Attempt, and Echo recording and playback) executable without access to the DOM, the canvas, or browser window objects, so that the simulation can be unit-tested headlessly.
8. THE Simulation, Recorder, Echo_Manager, Stage_Generator and Seeded_RNG scripts SHALL load both as classic `<script>` elements in the browser and in Node without a DOM, canvas or browser window objects, exposing the same functions in both environments, with the export mechanism left to design.

### Requirement 12: Headless Test Suite

**User Story:** As a developer, I want a dependency-free automated test suite, so that I can verify determinism, replay, gate logic and the Echo limit without installing anything.

#### Acceptance Criteria

1. THE Test_Suite SHALL run with Node's built-in test runner (`node --test`), with no `npm install`, no package dependencies, and no third-party test or property-testing libraries.
2. THE Test_Suite SHALL load the Simulation, Recorder, Echo_Manager and Stage_Generator scripts in Node without a DOM, canvas or browser window objects.
3. THE Test_Suite SHALL generate property test cases from a seeded generator (the Game's Seeded_RNG or a test-local seeded generator) with a fixed, reported base seed, about 500 cases per property, and generated Input_Logs of up to 3,600 Ticks.
4. IF a property test case fails, THEN THE Test_Suite SHALL report the case's seed so that the case can be reproduced.
5. THE Test_Suite SHALL include property tests for criteria 1.5, 1.10, 4.3, 5.5, 6.8, 9.6 and 9.10.
6. THE Test_Suite SHALL include a property test of the rune placement property (criterion 9.12) over Stages 1 to 50.
7. THE Test_Suite SHALL include a crossing coverage property test: FOR ALL seeded random Rune/Rune_Gate pairs satisfying criterion 6.1 and seeded Echo paths that intersect the Rune and remain present until the Echo's hitbox leaves the Rune, the linked Rune_Gate SHALL be open on every Tick on which a Player hitbox at the same horizontal position intersects the Rune_Gate's area (crossing coverage property).
