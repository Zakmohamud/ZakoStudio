import handler from "../../netlify/functions/christmas-admin.mjs";

export const onRequest = ({ request }) => handler(request);
