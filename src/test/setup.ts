import "@testing-library/jest-dom/vitest";

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
