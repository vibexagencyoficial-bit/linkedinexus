/**
 * VibexCorp Chrome Extension - Content Script
 * Runs safely on LinkedIn profile pages to assist lead capture.
 * Never alters DOM, never bypasses platform security, never automates unassisted clicks.
 */

export function extractProfileData() {
  if (!window.location.hostname.includes("linkedin.com") || !window.location.pathname.startsWith("/in/")) {
    return null;
  }

  const nameEl = document.querySelector("h1");
  const fullName = nameEl ? nameEl.innerText.trim() : "";

  // Title / Headline
  const headlineEl = document.querySelector(".text-body-medium.break-words");
  const headline = headlineEl ? headlineEl.textContent?.trim() || "" : "";

  // Extract company and job title heuristics
  let company = "";
  let jobTitle = headline;
  if (headline.includes(" at ")) {
    const parts = headline.split(" at ");
    jobTitle = parts[0].trim();
    company = parts[1].trim();
  } else if (headline.includes(" na ")) {
    const parts = headline.split(" na ");
    jobTitle = parts[0].trim();
    company = parts[1].trim();
  } else if (headline.includes(" @ ")) {
    const parts = headline.split(" @ ");
    jobTitle = parts[0].trim();
    company = parts[1].trim();
  }

  const nameParts = fullName.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    company: company,
    job_title: jobTitle,
    linkedin_url: window.location.origin + window.location.pathname,
  };
}

// Listen for capture requests from popup or sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "GET_PROFILE_CONTEXT") {
    const data = extractProfileData();
    sendResponse({ profile: data });
  }
});
