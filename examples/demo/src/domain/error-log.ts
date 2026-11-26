/** Une erreur reçue par `onError`, telle que l'exemple « Erreurs » l'affiche. */
export type LoggedError = { message: string; tag: string; phase: string; caughtBy: string | null };
