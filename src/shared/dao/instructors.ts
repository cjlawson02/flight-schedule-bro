import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";

export const InstructorMetadataSchema = z.object({
  instructorId: z.uuid(),
  displayName: z.string(),
});

export type InstructorMetadata = z.infer<typeof InstructorMetadataSchema>;

const InstructorsResponseSchema = z.object({
  results: z.array(InstructorMetadataSchema),
});

export async function getInstructors(operatorId: number) {
  return safeFetch(
    `https://api-external.flightschedulepro.com/api/instructors?operatorId=${operatorId}&includeInactive=false&pageSize=0&returnPersonName=true`,
    "GET",
    null,
    InstructorsResponseSchema,
    // 3 days
    3 * 24 * 60 * 60 * 1000,
  );
}
