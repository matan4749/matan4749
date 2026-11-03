from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Requirement:
    """A requirement taken from the job text. Nothing here is inferred beyond that text."""

    text: str
    kind: str  # experience | skill | education | other
    years: float | None = None
    domain: str | None = None
    priority: str = "required"  # required | preferred
    section: str = ""


@dataclass
class JobPosting:
    title: str
    url: str
    company: str = ""
    location: str = ""
    description: str = ""
    requirements: list[Requirement] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class RequirementMatch:
    requirement: Requirement
    status: str  # met | partial | missing
    evidence: str


@dataclass
class CvProfile:
    path_name: str
    text: str
    total_years: float | None
    years_method: str
    skill_years: dict[str, float]
    skill_present: set[str]


@dataclass
class ScoredJob:
    job: JobPosting
    match_percent: int | None
    reason: str
    matches: list[RequirementMatch]
    included: bool


@dataclass
class RunResult:
    source_url: str
    cv_name: str
    threshold: int
    generated_at: datetime
    profile: CvProfile
    jobs: list[ScoredJob]
    errors: list[str]
    notes: list[str]
    pages_fetched: int
    markdown_path: str = ""
    html_path: str = ""

    def included_jobs(self) -> list[ScoredJob]:
        return sorted(
            (job for job in self.jobs if job.included),
            key=lambda job: (-(job.match_percent or 0), job.job.title),
        )

    def below_threshold(self) -> list[ScoredJob]:
        return sorted(
            (
                job
                for job in self.jobs
                if job.match_percent is not None and not job.included
            ),
            key=lambda job: (-(job.match_percent or 0), job.job.title),
        )

    def unscored(self) -> list[ScoredJob]:
        return [job for job in self.jobs if job.match_percent is None]
