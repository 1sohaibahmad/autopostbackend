import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";

function extractBearerToken(authorization?: string): string {
  if (!authorization) {
    throw new HttpError(401, "Missing Authorization header", "UNAUTHORIZED");
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new HttpError(401, "Invalid Authorization header", "UNAUTHORIZED");
  }
  return token;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new HttpError(401, "Invalid or expired token", "UNAUTHORIZED");
    }

    req.auth = {
      token,
      user: data.user,
    };

    next();
  } catch (error) {
    next(error);
  }
}
