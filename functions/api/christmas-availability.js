import handler from "../../netlify/functions/christmas-availability.mjs";

export const onRequest = ({ request }) => handler(request);
