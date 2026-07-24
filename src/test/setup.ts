import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Testing Library's 1s default for waitFor measures wall-clock time, not work,
// so a machine busy with a concurrent build fails assertions that are actually
// correct. Three unrelated tests were observed flaking that way. A longer
// ceiling changes nothing about a passing run — waitFor returns as soon as the
// condition holds — it only stops a loaded CI box from inventing failures.
configure({ asyncUtilTimeout: 5000 });

// jsdom stubs HTMLFormElement.requestSubmit() as a no-op "not implemented"
// warning rather than dispatching a submit event. React's <form action={fn}>
// calls it internally when a submit button is clicked, so without this
// polyfill, component tests that click a submit button never invoke the
// bound action.
HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  if (submitter) {
    Object.defineProperty(event, "submitter", { value: submitter });
  }
  this.dispatchEvent(event);
};
