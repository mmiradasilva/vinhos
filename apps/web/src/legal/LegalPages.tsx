import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LEGAL_VERSION, OPERATOR, operatorComplete } from './operator';

const blank = (v: string, label: string) => v || `[${label}]`;
const name = blank(OPERATOR.name, 'operator name');
const email = blank(OPERATOR.contactEmail, 'contact email');

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="legal">
      {!operatorComplete && (
        <p className="notice notice-warning" role="note">
          Draft: the operator details in <code>apps/web/src/legal/operator.ts</code> are not filled in yet, and this text has not been
          reviewed. Don't launch publicly until both are done.
        </p>
      )}
      <h1>{title}</h1>
      <p className="muted">Version {LEGAL_VERSION}</p>
      {children}
      <p>
        <Link to="/signin">Back</Link>
      </p>
    </article>
  );
}

/** Privacy notice: describes exactly what the app stores (sign-in §6, add-wine §6). */
export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy notice">
      <h2>Who we are</h2>
      <p>
        Cellar is run by {name}. For any question about your data, or to use your rights, write to {email}.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>From your Google account, when you sign in:</strong> your Google account ID, email address and name. We ask Google for
          nothing else and keep no Google access tokens.
        </li>
        <li>
          <strong>Your agreement:</strong> when you accepted these terms and which version.
        </li>
        <li>
          <strong>Your collection:</strong> the wines you enter and everything you type about them (producer, vintage, quantity, prices,
          purchase dates, storage location, notes).
        </li>
        <li>
          <strong>Producers, regions and grapes you add</strong> to the shared lists. They are private to you until another user uses the
          same entry; then they become visible to everyone, without your name.
        </li>
        <li>
          <strong>A session cookie</strong> that keeps you signed in for up to 30 days of inactivity. It is strictly necessary for the
          service. We use no analytics, advertising or tracking cookies.
        </li>
        <li>
          <strong>Technical logs</strong> (IP address, time, page requested) kept by our hosting provider for security and to fix
          problems.
        </li>
      </ul>

      <h2>Why, and on what basis</h2>
      <p>
        To provide the service you signed up for (performance of a contract), and to keep it secure and prevent abuse (our legitimate
        interest). We do not sell your data or use it for advertising.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>Render (hosting and database), in its Frankfurt, Germany region.</li>
        <li>Google, only to let you sign in with your Google account.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        As long as your account exists. Expired sessions are deleted daily. When you ask us to delete your account, we delete your
        account and collection within 30 days.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to access, correct, export or delete your data, or object to how we use it, by writing to {email}. You can also
        complain to {blank(OPERATOR.supervisoryAuthority, 'data-protection authority')}.
      </p>

      <h2>Changes</h2>
      <p>If this notice changes, the version above changes and we tell you in the app.</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of use">
      <h2>The service</h2>
      <p>
        Cellar, run by {name}, lets you keep a record of the wines you own. It is provided free of charge and "as is". We may change or
        stop it; if we stop it, we will tell you in advance so you can ask for a copy of your data.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with your own Google account and are responsible for what is done with it. You must be old enough to buy alcohol
        where you live.
      </p>

      <h2>Your content</h2>
      <p>
        Your collection is yours and private to you. Names you add to the shared lists of producers, regions and grapes may become
        visible to other users; don't enter anything offensive, unlawful or personal there. We may correct or remove such entries.
      </p>

      <h2>Fair use</h2>
      <p>Don't try to break, overload or misuse the service, or access other people's data. We may suspend accounts that do.</p>

      <h2>Liability</h2>
      <p>
        We take care to keep your data safe, but we can't guarantee the service will always be available or error-free. Keep your own
        records of anything valuable. Nothing in these terms limits rights you have by law.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the law of {blank(OPERATOR.country, 'country')}.</p>

      <h2>Contact</h2>
      <p>{email}</p>
    </LegalLayout>
  );
}
