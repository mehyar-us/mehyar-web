import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Places onboarding panels (React migration S4): the Google Places
 * wizard cards (search → candidates → confirm → fit check / next steps
 * with the vertical choice). Rendered by React 19 from the view state
 * createPlacesOnboarding (places-onboarding.ts) maintains; all Places
 * I/O, progress reporting, and step execution stay in the module.
 * The status line renders as the card's last child, where the
 * imperative say() appended it. */

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  hours: string[];
  photoUrl: string;
  category: string;
}

export interface ConfirmCardData {
  title: string;
  placeId: string;
  name: string;
  photoUrl: string;
  address: string;
  hoursSummary: string;
  phone: string;
}

export interface VerticalView {
  framing: string;
  modeLabel: string;
  phase: 'choice' | 'picker' | 'use-done' | 'picked-done' | 'skipped';
  busy: boolean;
  doneText: string;
  followUp: string | null;
  options: { key: string; label: string }[];
}

export interface StepView {
  label: string;
  testOnly: boolean;
  done: boolean;
  busy: boolean;
}

export interface PlacesViewState {
  screen: 'idle' | 'search' | 'candidates' | 'confirm' | 'fitcheck' | 'nextsteps';
  status: string | null;
  searchBusy: boolean;
  candidates: PlaceCandidate[];
  confirm: ConfirmCardData | null;
  confirmBusy: boolean;
  fitMessage: string;
  businessName: string;
  vertical: VerticalView | null;
  followUpQuestion: string | null;
  steps: StepView[];
}

export interface PlacesActions {
  search: (query: string) => void;
  skipSearch: () => void;
  pickCandidate: (placeId: string) => void;
  searchAgain: () => void;
  confirmYes: () => void;
  confirmNotUs: () => void;
  fitContinue: () => void;
  fitNotNow: () => void;
  verticalUse: () => void;
  verticalDifferent: () => void;
  verticalPick: (key: string) => void;
  verticalSkip: () => void;
  runStep: (index: number) => void;
  doneForNow: () => void;
}

export interface PlacesPanelsProps {
  view: PlacesViewState;
  actions: PlacesActions;
}

function Status({ view }: { view: PlacesViewState }) {
  if (!view.status) return null;
  return (
    <p className="places-status" role="status">
      {view.status}
    </p>
  );
}

function SearchCard({ view, actions }: PlacesPanelsProps) {
  const [query, setQuery] = useState('');
  return (
    <div className="places-card">
      <h3>Find your business on Google</h3>
      <p>Skip the typing — I’ll pull your name, address, hours, and phone from your Google listing.</p>
      <form
        className="places-search"
        onSubmit={(event) => {
          event.preventDefault();
          const q = query.trim();
          if (q) actions.search(q);
        }}
      >
        <input
          type="search"
          required
          maxLength={200}
          placeholder="Business name + city"
          aria-label="Search for your business on Google"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="primary" disabled={view.searchBusy}>
          Look it up
        </button>
      </form>
      <button type="button" className="quiet" onClick={actions.skipSearch}>
        I’ll answer the questions instead
      </button>
      <Status view={view} />
    </div>
  );
}

function CandidatesCard({ view, actions }: PlacesPanelsProps) {
  return (
    <div className="places-card">
      <h3>Which one is yours?</h3>
      <div className="places-candidates">
        {view.candidates.map((candidate) => (
          <button
            key={candidate.placeId}
            type="button"
            className="secondary places-candidate"
            onClick={() => actions.pickCandidate(candidate.placeId)}
          >
            <strong>{candidate.name}</strong>
            <span>{candidate.address || 'Address not listed'}</span>
          </button>
        ))}
      </div>
      <button type="button" className="quiet" onClick={actions.searchAgain}>
        ← Search again
      </button>
      <Status view={view} />
    </div>
  );
}

function ConfirmCard({ view, actions }: PlacesPanelsProps) {
  const card = view.confirm;
  if (!card) return null;
  return (
    <div className="places-card places-confirm">
      <h3>{card.title || 'Is this you?'}</h3>
      {card.photoUrl && <img className="places-photo" src={card.photoUrl} alt={card.name} loading="lazy" />}
      <p className="places-name">{card.name}</p>
      {card.address && <p>{card.address}</p>}
      {card.hoursSummary && <p className="places-hours">{card.hoursSummary}</p>}
      {card.phone && <p>{card.phone}</p>}
      <div className="places-actions">
        <button type="button" className="primary" disabled={view.confirmBusy} onClick={actions.confirmYes}>
          Yes, that’s us
        </button>
        <button type="button" className="secondary" disabled={view.confirmBusy} onClick={actions.confirmNotUs}>
          Not us
        </button>
      </div>
      <Status view={view} />
    </div>
  );
}

function FitCheckCard({ view, actions }: PlacesPanelsProps) {
  return (
    <div className="places-card places-fit-check">
      <h3>A straight answer first</h3>
      <p className="places-fit-message">{view.fitMessage}</p>
      <div className="places-actions">
        <button type="button" className="primary" onClick={actions.fitContinue}>
          Continue anyway
        </button>
        <button type="button" className="secondary" onClick={actions.fitNotNow}>
          Not now
        </button>
      </div>
      <Status view={view} />
    </div>
  );
}

function VerticalChoice({ view, actions }: PlacesPanelsProps) {
  const vertical = view.vertical;
  if (!vertical || vertical.phase === 'skipped') return null;
  if (vertical.phase === 'use-done' || vertical.phase === 'picked-done') {
    return (
      <div className="places-vertical-choice">
        <p className="places-question">{vertical.doneText}</p>
        {vertical.phase === 'use-done' && vertical.followUp && (
          <>
            <p>{vertical.followUp}</p>
            <p className="places-hint">Reply in chat — I’ll remember your answer.</p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="places-vertical-choice">
      <p className="places-question">{vertical.framing}</p>
      <div className="places-actions">
        {vertical.phase === 'picker' ? (
          <select
            aria-label="Choose a business type"
            disabled={vertical.busy}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) actions.verticalPick(event.target.value);
            }}
          >
            <option value="">Pick a business type…</option>
            {vertical.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <button type="button" className="primary" disabled={vertical.busy} onClick={actions.verticalUse}>
              {`Use ${vertical.modeLabel} mode`}
            </button>
            <button type="button" className="secondary" disabled={vertical.busy} onClick={actions.verticalDifferent}>
              Choose different
            </button>
            <button type="button" className="quiet" disabled={vertical.busy} onClick={actions.verticalSkip}>
              Continue without a vertical
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function NextStepsCard({ view, actions }: PlacesPanelsProps) {
  return (
    <div className="places-card">
      <h3>{`Got it — ${view.businessName} is saved.`}</h3>
      {view.vertical ? (
        <VerticalChoice view={view} actions={actions} />
      ) : view.followUpQuestion ? (
        <>
          <p className="places-question">{view.followUpQuestion}</p>
          <p className="places-hint">Reply in chat — I’ll remember your answer.</p>
        </>
      ) : null}
      <div className="places-steps">
        {view.steps.map((step, index) => (
          <button
            key={step.label}
            type="button"
            className="secondary places-step"
            disabled={step.busy || step.done}
            onClick={() => actions.runStep(index)}
          >
            <span>{step.done ? `✓ ${step.label}` : step.label}</span>
            {step.testOnly && <span className="places-test-badge">TEST ONLY</span>}
          </button>
        ))}
      </div>
      <button type="button" className="quiet" onClick={actions.doneForNow}>
        Done for now
      </button>
      <Status view={view} />
    </div>
  );
}

export function PlacesPanels({ view, actions }: PlacesPanelsProps) {
  switch (view.screen) {
    case 'search':
      return <SearchCard view={view} actions={actions} />;
    case 'candidates':
      return <CandidatesCard view={view} actions={actions} />;
    case 'confirm':
      return <ConfirmCard view={view} actions={actions} />;
    case 'fitcheck':
      return <FitCheckCard view={view} actions={actions} />;
    case 'nextsteps':
      return <NextStepsCard view={view} actions={actions} />;
    default:
      return null;
  }
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountPlacesPanels(element: HTMLElement, props: PlacesPanelsProps): void {
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<PlacesPanels {...props} />);
}
