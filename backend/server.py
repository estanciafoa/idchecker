from fastapi import FastAPI, APIRouter, HTTPException, Depends, Security
from fastapi.security import APIKeyHeader
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import csv
import io
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import httpx
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# API key auth
API_KEY = os.environ.get('API_KEY', 'Admin2026')
api_key_header = APIKeyHeader(name='X-API-Key', auto_error=False)

async def verify_api_key(api_key: str = Security(api_key_header)):
    if not api_key or api_key != API_KEY:
        raise HTTPException(status_code=401, detail='Invalid or missing API key')
    return api_key

app = FastAPI()
api_router = APIRouter(prefix="/api", dependencies=[Depends(verify_api_key)])


# Models
class Resident(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    unit: str
    aadhar_masked: str = ""
    vehicle_plate: Optional[str] = ""
    photo_url: Optional[str] = ""
    photo_base64: Optional[str] = ""
    validity: Optional[str] = ""
    status: str = "active"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ResidentCreate(BaseModel):
    id: Optional[str] = None
    name: str
    unit: str
    aadhar_masked: str = ""
    vehicle_plate: Optional[str] = ""
    photo_url: Optional[str] = ""
    photo_base64: Optional[str] = ""
    validity: Optional[str] = ""
    status: str = "active"


class ResidentUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    aadhar_masked: Optional[str] = None
    vehicle_plate: Optional[str] = None
    photo_url: Optional[str] = None
    photo_base64: Optional[str] = None
    validity: Optional[str] = None
    status: Optional[str] = None


class AccessLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    resident_id: str
    resident_name: str
    unit: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    status: str = "verified"


class AccessLogCreate(BaseModel):
    resident_id: str
    resident_name: str
    unit: str
    status: str = "verified"


class SheetImportRequest(BaseModel):
    sheet_url: str


# Seed data
SEED_RESIDENTS = [
    {
        "id": "RES001",
        "name": "Rajesh Kumar",
        "unit": "A-101",
        "aadhar_masked": "XXXX-XXXX-4523",
        "vehicle_plate": "KA 01 AB 1234",
        "photo_url": "",
        "photo_base64": "",
        "validity": "2024-2026",
        "status": "active",
        "created_at": "2024-01-15T10:00:00Z",
        "updated_at": "2024-01-15T10:00:00Z"
    },
    {
        "id": "RES002",
        "name": "Priya Sharma",
        "unit": "B-205",
        "aadhar_masked": "XXXX-XXXX-7891",
        "vehicle_plate": "KA 02 CD 5678",
        "photo_url": "",
        "photo_base64": "",
        "validity": "2024-2026",
        "status": "active",
        "created_at": "2024-02-10T10:00:00Z",
        "updated_at": "2024-02-10T10:00:00Z"
    },
    {
        "id": "RES003",
        "name": "Amit Patel",
        "unit": "C-302",
        "aadhar_masked": "XXXX-XXXX-3456",
        "vehicle_plate": "KA 03 EF 9012",
        "photo_url": "",
        "photo_base64": "",
        "validity": "2024-2026",
        "status": "active",
        "created_at": "2024-03-05T10:00:00Z",
        "updated_at": "2024-03-05T10:00:00Z"
    },
    {
        "id": "RES004",
        "name": "Sneha Reddy",
        "unit": "A-404",
        "aadhar_masked": "XXXX-XXXX-6789",
        "vehicle_plate": "",
        "photo_url": "",
        "photo_base64": "",
        "validity": "2025-2027",
        "status": "active",
        "created_at": "2024-04-20T10:00:00Z",
        "updated_at": "2024-04-20T10:00:00Z"
    },
    {
        "id": "RES005",
        "name": "Mohammed Ali",
        "unit": "D-102",
        "aadhar_masked": "XXXX-XXXX-1234",
        "vehicle_plate": "KA 05 GH 3456",
        "photo_url": "",
        "photo_base64": "",
        "validity": "2023-2025",
        "status": "inactive",
        "created_at": "2024-05-12T10:00:00Z",
        "updated_at": "2024-05-12T10:00:00Z"
    }
]


@app.on_event("startup")
async def seed_database():
    count = await db.residents.count_documents({})
    if count == 0:
        for resident in SEED_RESIDENTS:
            await db.residents.insert_one(resident)
        logging.info("Seeded database with sample residents")


# Residents endpoints
@api_router.get("/residents", response_model=List[Resident])
async def get_residents():
    residents = await db.residents.find({}, {"_id": 0}).to_list(1000)
    return residents


@api_router.get("/residents/{resident_id}", response_model=Resident)
async def get_resident(resident_id: str):
    resident = await db.residents.find_one({"id": resident_id}, {"_id": 0})
    if not resident:
        raise HTTPException(status_code=404, detail="Resident not found")
    return resident


@api_router.post("/residents", response_model=Resident)
async def create_resident(data: ResidentCreate):
    resident_dict = data.dict()
    if not resident_dict.get("id"):
        resident_dict["id"] = f"RES{str(uuid.uuid4())[:6].upper()}"
    resident_dict["created_at"] = datetime.now(timezone.utc).isoformat()
    resident_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.residents.update_one(
        {"id": resident_dict["id"]},
        {"$set": resident_dict},
        upsert=True
    )
    result = await db.residents.find_one({"id": resident_dict["id"]}, {"_id": 0})
    return result


@api_router.put("/residents/{resident_id}", response_model=Resident)
async def update_resident(resident_id: str, data: ResidentUpdate):
    existing = await db.residents.find_one({"id": resident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Resident not found")
    update_data = {k: v for k, v in data.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.residents.update_one({"id": resident_id}, {"$set": update_data})
    updated = await db.residents.find_one({"id": resident_id}, {"_id": 0})
    return updated


@api_router.delete("/residents/{resident_id}")
async def delete_resident(resident_id: str):
    result = await db.residents.delete_one({"id": resident_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Resident not found")
    return {"message": "Resident deleted", "id": resident_id}


# Import from Google Sheet (published as CSV)
@api_router.post("/import-sheet")
async def import_from_sheet(data: SheetImportRequest):
    """
    Import residents from a published Google Sheet.
    The sheet_url should be the published CSV URL, e.g.:
    https://docs.google.com/spreadsheets/d/e/XXXXX/pub?output=csv
    
    Or provide the pubhtml URL and we'll convert it automatically.
    Expected columns: ID, Name, Flat, Aadhar, Photo URL, Validity
    """
    sheet_url = data.sheet_url.strip()
    
    # Validate URL scheme - only allow HTTPS Google Sheets URLs
    parsed = urlparse(sheet_url)
    if parsed.scheme not in ('https',) or 'docs.google.com' not in (parsed.hostname or ''):
        raise HTTPException(status_code=400, detail="Only Google Sheets HTTPS URLs are allowed")
    
    # Convert pubhtml URL to CSV URL if needed
    if "pubhtml" in sheet_url:
        sheet_url = sheet_url.replace("pubhtml", "pub?output=csv")
    elif "/pub?" not in sheet_url and "pub?output=csv" not in sheet_url:
        # Try to make it a CSV export URL
        if sheet_url.endswith("/"):
            sheet_url = sheet_url[:-1]
        sheet_url = sheet_url + "?output=csv" if "?" not in sheet_url else sheet_url + "&output=csv"
    elif "output=csv" not in sheet_url:
        sheet_url = sheet_url + "&output=csv" if "?" in sheet_url else sheet_url + "?output=csv"

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client_http:
            response = await client_http.get(sheet_url)
            response.raise_for_status()
            csv_content = response.text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch sheet: {str(e)}")

    # Parse CSV
    reader = csv.DictReader(io.StringIO(csv_content))
    imported_count = 0
    errors = []

    for row_num, row in enumerate(reader, start=2):
        try:
            # Map columns (flexible matching)
            resident_id = (row.get("ID") or row.get("id") or row.get("Id") or "").strip()
            name = (row.get("Name") or row.get("name") or row.get("NAME") or "").strip()
            flat = (row.get("Flat") or row.get("flat") or row.get("FLAT") or row.get("Unit") or "").strip()
            aadhar = (row.get("Aadhar") or row.get("aadhar") or row.get("AADHAR") or row.get("Aadhar Number") or "").strip()
            photo_url = (row.get("Photo URL") or row.get("photo_url") or row.get("Photo") or row.get("photo") or "").strip()
            validity = (row.get("Validity") or row.get("validity") or row.get("VALIDITY") or "").strip()
            vehicle = (row.get("Vehicle") or row.get("vehicle") or row.get("Vehicle Plate") or row.get("vehicle_plate") or "").strip()

            if not resident_id or not name:
                continue  # Skip empty rows

            resident_data = {
                "id": resident_id,
                "name": name,
                "unit": flat,
                "aadhar_masked": aadhar,
                "photo_url": photo_url,
                "photo_base64": "",
                "vehicle_plate": vehicle,
                "validity": validity,
                "status": "active",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

            # Upsert - update if exists, insert if new
            existing = await db.residents.find_one({"id": resident_id})
            if existing:
                resident_data.pop("status", None)
                await db.residents.update_one({"id": resident_id}, {"$set": resident_data})
            else:
                resident_data["created_at"] = datetime.now(timezone.utc).isoformat()
                await db.residents.insert_one(resident_data)
            
            imported_count += 1
        except Exception as e:
            errors.append(f"Row {row_num}: {str(e)}")

    return {
        "message": f"Imported {imported_count} residents from sheet",
        "imported": imported_count,
        "errors": errors,
        "synced_at": datetime.now(timezone.utc).isoformat()
    }


# Access logs endpoints
@api_router.get("/access-logs", response_model=List[AccessLog])
async def get_access_logs():
    logs = await db.access_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(500)
    return logs


@api_router.post("/access-logs", response_model=AccessLog)
async def create_access_log(data: AccessLogCreate):
    log = AccessLog(**data.dict())
    await db.access_logs.insert_one(log.dict())
    result = await db.access_logs.find_one({"id": log.id}, {"_id": 0})
    return result


# Sync endpoint - returns all residents for local download
@api_router.get("/sync")
async def sync_residents():
    residents = await db.residents.find({}, {"_id": 0}).to_list(5000)
    return {
        "residents": residents,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "count": len(residents)
    }


# Get/Set sheet URL config
@api_router.get("/config/sheet-url")
async def get_sheet_url():
    config = await db.app_config.find_one({"key": "sheet_url"}, {"_id": 0})
    return {"sheet_url": config.get("value", "") if config else ""}


@api_router.post("/config/sheet-url")
async def set_sheet_url(data: SheetImportRequest):
    await db.app_config.update_one(
        {"key": "sheet_url"},
        {"$set": {"key": "sheet_url", "value": data.sheet_url.strip()}},
        upsert=True
    )
    return {"message": "Sheet URL saved", "sheet_url": data.sheet_url.strip()}


@api_router.get("/")
async def root():
    return {"message": "Gate ID Check API", "status": "online"}


ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', 'http://localhost:8080,http://localhost:19006').split(',')

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-API-Key"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
