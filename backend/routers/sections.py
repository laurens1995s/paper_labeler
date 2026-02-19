from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import SessionLocal, Question, SectionDef, SectionGroup, SectionGroupMember
from backend.schemas.schemas import SectionDefCreate, SectionDefUpdate, SectionGroupCreate, SectionGroupUpdate
from backend.dependencies import get_db

router = APIRouter(tags=["sections"])


@router.get("/sections")
def list_sections(db: Session = Depends(get_db)):
    rows1 = db.query(Question.section).distinct().all()
    rows2 = db.query(SectionDef.name).distinct().all()
    sections = sorted({r[0] for r in rows1 + rows2 if r[0]})
    return {"sections": sections}

@router.get("/section_defs")
def list_section_defs(db: Session = Depends(get_db)):
    rows = db.query(SectionDef).order_by(SectionDef.name.asc()).all()
    members = db.query(SectionGroupMember).all()
    groups = db.query(SectionGroup).all()
    group_by_id = {g.id: g for g in groups}
    member_by_name = {m.section_name: m.group_id for m in members}
    return {
        "sections": [
            {
                "id": r.id,
                "name": r.name,
                "content": r.content,
                "group_id": member_by_name.get(r.name),
                "group_name": group_by_id.get(member_by_name.get(r.name)).name if member_by_name.get(r.name) in group_by_id else None,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]
    }

@router.post("/section_defs")
def create_section_def(payload: SectionDefCreate, db: Session = Depends(get_db)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    exists = db.query(SectionDef).filter(SectionDef.name == name).one_or_none()
    if exists is not None:
        raise HTTPException(status_code=409, detail="section name exists")
    row = SectionDef(name=name, content=payload.content)
    db.add(row)
    db.commit()
    db.refresh(row)
    if payload.group_id:
        group = db.query(SectionGroup).filter(SectionGroup.id == payload.group_id).one_or_none()
        if group is None:
            raise HTTPException(status_code=400, detail="group not found")
        db.add(SectionGroupMember(group_id=payload.group_id, section_name=row.name))
        db.commit()
        db.refresh(row)
    return {"section": {"id": row.id, "name": row.name, "content": row.content, "group_id": payload.group_id, "updated_at": row.updated_at}}

@router.patch("/section_defs/{section_id}")
def update_section_def(section_id: int, payload: SectionDefUpdate, db: Session = Depends(get_db)):
    row = db.query(SectionDef).filter(SectionDef.id == section_id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="section not found")

    old_name = row.name
    data = payload.model_dump(exclude_unset=True)
    renamed_to: str | None = None
    if "name" in data and data["name"] is not None:
        new_name = data["name"].strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name required")
        other = db.query(SectionDef).filter(SectionDef.name == new_name, SectionDef.id != row.id).one_or_none()
        if other is not None:
            raise HTTPException(status_code=409, detail="section name exists")
        row.name = new_name
        renamed_to = new_name
    if "content" in data:
        row.content = data["content"]
    group_handled = False
    if "group_id" in data:
        gid = data.get("group_id")
        target_name = renamed_to or old_name
        db.query(SectionGroupMember).filter(SectionGroupMember.section_name == old_name).delete()
        if gid:
            group = db.query(SectionGroup).filter(SectionGroup.id == gid).one_or_none()
            if group is None:
                raise HTTPException(status_code=400, detail="group not found")
            db.add(SectionGroupMember(group_id=gid, section_name=target_name))
        group_handled = True

    updated_questions = 0
    if renamed_to is not None and old_name and renamed_to and old_name != renamed_to:
        updated_questions = (
            db.query(Question)
            .filter(Question.section == old_name)
            .update({Question.section: renamed_to}, synchronize_session=False)
        )
        if not group_handled:
            db.query(SectionGroupMember).filter(SectionGroupMember.section_name == old_name).update(
                {SectionGroupMember.section_name: renamed_to}, synchronize_session=False
            )
    db.add(row)
    db.commit()
    db.refresh(row)
    member = db.query(SectionGroupMember).filter(SectionGroupMember.section_name == row.name).one_or_none()
    return {
        "section": {
            "id": row.id,
            "name": row.name,
            "content": row.content,
            "group_id": member.group_id if member else None,
            "updated_at": row.updated_at,
        },
        "updated_questions": updated_questions,
    }

@router.delete("/section_defs/{section_id}")
def delete_section_def(section_id: int, db: Session = Depends(get_db)):
    row = db.query(SectionDef).filter(SectionDef.id == section_id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="section not found")
    db.query(SectionGroupMember).filter(SectionGroupMember.section_name == row.name).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/section_groups")
def list_section_groups(db: Session = Depends(get_db)):
    rows = db.query(SectionGroup).order_by(SectionGroup.name.asc()).all()
    return {
        "groups": [
            {"id": r.id, "name": r.name, "show_in_filter": r.show_in_filter, "updated_at": r.updated_at}
            for r in rows
        ]
    }


@router.post("/section_groups")
def create_section_group(payload: SectionGroupCreate, db: Session = Depends(get_db)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    exists = db.query(SectionGroup).filter(SectionGroup.name == name).one_or_none()
    if exists is not None:
        raise HTTPException(status_code=409, detail="group name exists")
    row = SectionGroup(name=name, show_in_filter=payload.show_in_filter if payload.show_in_filter is not None else True)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"group": {"id": row.id, "name": row.name, "show_in_filter": row.show_in_filter, "updated_at": row.updated_at}}


@router.patch("/section_groups/{group_id}")
def update_section_group(group_id: int, payload: SectionGroupUpdate, db: Session = Depends(get_db)):
    row = db.query(SectionGroup).filter(SectionGroup.id == group_id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="group not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        new_name = data["name"].strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name required")
        other = db.query(SectionGroup).filter(SectionGroup.name == new_name, SectionGroup.id != row.id).one_or_none()
        if other is not None:
            raise HTTPException(status_code=409, detail="group name exists")
        row.name = new_name
    if "show_in_filter" in data and data["show_in_filter"] is not None:
        row.show_in_filter = bool(data["show_in_filter"])
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"group": {"id": row.id, "name": row.name, "show_in_filter": row.show_in_filter, "updated_at": row.updated_at}}


@router.delete("/section_groups/{group_id}")
def delete_section_group(group_id: int, db: Session = Depends(get_db)):
    row = db.query(SectionGroup).filter(SectionGroup.id == group_id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="group not found")
    db.query(SectionGroupMember).filter(SectionGroupMember.group_id == row.id).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}
